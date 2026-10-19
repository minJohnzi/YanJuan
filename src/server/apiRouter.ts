import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response, type Router } from 'express';
import { runPaperBuildPipeline } from '../pipeline/buildPipeline.ts';
import { PipelineSecurityError } from '../pipeline/zipSecurity.ts';
import type {
  ModelCapabilities,
  ProviderCredentialStatus,
  SubjectiveEvaluationResult,
} from '../shared/types.ts';
import {
  runFollowUpAnalysis,
  runObjectiveQuestionAnalysis,
  runStage2ReviewOnly,
  runTwoStageSubjectiveEvaluation,
} from './aiEvaluators.ts';
import {
  DeepSeekProvider,
  GeminiProvider,
  type ModelProvider,
  OpenAICompatibleProvider,
} from './modelProviders.ts';
import {
  type EncryptedCredentialRecord,
  SecurityError,
  createRedactedLogEntry,
  decryptProviderApiKey,
  encryptProviderApiKey,
  isUserInOwnerUids,
  maskApiKey,
  validateSafeCustomBaseUrl,
} from './securityAndCrypto.ts';

export interface VerifiedAuthContext {
  uid: string | null;
  email?: string | null;
  emailVerified?: boolean;
  isGuest: boolean;
  sessionId: string;
}

export interface ApiRouterDependencies {
  rootDir?: string;
  verifyIdTokenFn?: (token: string) => Promise<{
    uid: string;
    email?: string;
    email_verified?: boolean;
  }>;
  customProviderFactory?: (
    provider: 'gemini' | 'deepseek' | 'openai-compatible',
    apiKey: string,
    model?: string,
    baseUrl?: string
  ) => ModelProvider;
  rateLimitMaxPerMinute?: number;
}

interface StoredImportJob {
  id: string;
  year: number;
  dataVersion: string;
  status: string;
  errorCodes: string[];
  missingObjectiveCount: number;
  createdAt: string;
}

/**
 * Creates the Express /api/v1 router with full security, rate limiting, idempotency,
 * credential encryption, and AI evaluation routes.
 */
export function createApiV1Router(deps: ApiRouterDependencies = {}): {
  router: Router;
  auditLogs: ReturnType<typeof createRedactedLogEntry>[];
  encryptedStore: Map<string, EncryptedCredentialRecord>;
} {
  const router = express.Router();
  const rootDir = deps.rootDir || process.cwd();
  const rateLimitMax = deps.rateLimitMaxPerMinute ?? 30;

  // Server-side encrypted credential store (mirrors /private-provider-credentials/{uid}/providers/{providerId})
  const encryptedStore = new Map<string, EncryptedCredentialRecord>();
  // Session-only HttpOnly cookie store (keyed by sessionId:provider)
  const sessionKeyStore = new Map<
    string,
    {
      provider: 'gemini' | 'deepseek' | 'openai-compatible';
      encrypted: EncryptedCredentialRecord;
    }
  >();
  // Server-side cached evaluations for stage-2 retry
  const evaluationCache = new Map<
    string,
    {
      evaluation: SubjectiveEvaluationResult;
      questionPrompt: string;
      userAnswer: string;
      requiredFacts?: string[];
      ownerUid: string | null;
    }
  >();
  // Import jobs store
  const importJobs = new Map<string, StoredImportJob>();
  // Rate limiting window map
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  // Idempotency cache
  const idempotencyCache = new Map<string, { status: number; body: unknown }>();
  const inFlightKeys = new Set<string>();
  // Redacted audit logs
  const auditLogs: ReturnType<typeof createRedactedLogEntry>[] = [];

  // Parse JSON with 2MB body limit
  router.use(express.json({ limit: '2mb' }));

  router.use((err: any, _req: Request, res: Response, next: express.NextFunction) => {
    if (err && err.type === 'entity.too.large') {
      res.status(413).json({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: '请求体大小超过 2MB 安全上限',
          details: [],
        },
      });
      return;
    }
    next(err);
  });

  // Helper: parse cookies without external middleware
  function parseCookies(req: Request): Record<string, string> {
    const header = req.headers.cookie || '';
    const out: Record<string, string> = {};
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        const k = part.slice(0, idx).trim();
        const v = decodeURIComponent(part.slice(idx + 1).trim());
        out[k] = v;
      }
    }
    return out;
  }

  function getOrSetSessionId(req: Request, res: Response): string {
    const cookies = parseCookies(req);
    if (cookies.yanjuan_sid && /^[a-zA-Z0-9_-]{12,64}$/.test(cookies.yanjuan_sid)) {
      return cookies.yanjuan_sid;
    }
    const sid = crypto.randomBytes(18).toString('base64url');
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader(
      'Set-Cookie',
      `yanjuan_sid=${sid}; Path=/; HttpOnly; SameSite=Lax${isSecure ? '; Secure' : ''}`
    );
    return sid;
  }

  // Auth extraction helper: NEVER trusts req.body.userId!
  async function resolveAuthContext(
    req: Request,
    res: Response,
    requireAuth: boolean = false
  ): Promise<VerifiedAuthContext | null> {
    const sessionId = getOrSetSessionId(req, res);
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      if (requireAuth) {
        res.status(401).json({
          error: {
            code: 'UNAUTHENTICATED',
            message: '该操作需要登录并携带有效的 Firebase ID Token',
            details: [],
          },
        });
        return null;
      }
      return { uid: null, isGuest: true, sessionId };
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      res.status(401).json({
        error: {
          code: 'INVALID_AUTH_TOKEN',
          message: 'Authorization Bearer Token 为空',
          details: [],
        },
      });
      return null;
    }

    try {
      if (deps.verifyIdTokenFn) {
        const decoded = await deps.verifyIdTokenFn(token);
        // Check if body or query tried to spoof another user's uid
        const bodyUserId = (req.body as any)?.userId || (req.query as any)?.userId;
        if (bodyUserId && bodyUserId !== decoded.uid) {
          res.status(403).json({
            error: {
              code: 'FORBIDDEN_USER_MISMATCH',
              message: '禁止访问或操作其他用户路径的数据',
              details: [],
            },
          });
          return null;
        }
        return {
          uid: decoded.uid,
          email: decoded.email || null,
          emailVerified: decoded.email_verified ?? true,
          isGuest: false,
          sessionId,
        };
      }

      // If Firebase Admin is not initialized with service account in local guest environment,
      // reject unverified tokens rather than faking cloud auth
      res.status(401).json({
        error: {
          code: 'FIREBASE_ADMIN_UNCONFIGURED',
          message: '服务端未配置 Firebase Admin 凭据，无法验证云端身份令牌',
          details: [],
        },
      });
      return null;
    } catch {
      res.status(401).json({
        error: {
          code: 'INVALID_AUTH_TOKEN',
          message: 'Firebase ID Token 验证失败或已过期',
          details: [],
        },
      });
      return null;
    }
  }

  // Rate limit guard
  function checkRateLimit(req: Request, res: Response, uid: string | null): boolean {
    const key = uid || req.ip || 'local-ip';
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    bucket.count += 1;
    if (bucket.count > rateLimitMax) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: `请求过于频繁，请在 ${retryAfterSec} 秒后重试`,
          details: [`retryAfterSeconds=${retryAfterSec}`],
        },
      });
      return false;
    }
    return true;
  }

  // Resolve ModelProvider for user/session or owner global env
  function resolveActiveProvider(
    auth: VerifiedAuthContext,
    requestedProvider: 'gemini' | 'deepseek' | 'openai-compatible' = 'gemini',
    requestedUseOwnerKey: boolean = false
  ): ModelProvider {
    const factory =
      deps.customProviderFactory ||
      ((prov, key, model, baseUrl) => {
        if (prov === 'deepseek') return new DeepSeekProvider(key, model, baseUrl);
        if (prov === 'openai-compatible')
          return new OpenAICompatibleProvider(key, baseUrl, model);
        return new GeminiProvider(key, model);
      });

    // Check if user requested or tried to force owner global key
    if (requestedUseOwnerKey && !isUserInOwnerUids(auth.uid)) {
      throw new SecurityError(
        'OWNER_KEY_FORBIDDEN',
        '当前用户不在站长白名单 (OWNER_UIDS) 中，禁止使用站长全局模型密钥',
        403
      );
    }

    // 1. Check user's encrypted persistent credential (if logged in)
    if (auth.uid) {
      const encRec = encryptedStore.get(`${auth.uid}:${requestedProvider}`);
      if (encRec) {
        const plainKey = decryptProviderApiKey(auth.uid, requestedProvider, encRec);
        return factory(requestedProvider, plainKey, encRec.model, encRec.baseUrl);
      }
    }

    // 2. Check session-only HttpOnly cookie store
    const sessRec = sessionKeyStore.get(`${auth.sessionId}:${requestedProvider}`);
    if (sessRec) {
      const ownerId = auth.uid || auth.sessionId;
      const plainKey = decryptProviderApiKey(ownerId, requestedProvider, sessRec.encrypted);
      return factory(
        requestedProvider,
        plainKey,
        sessRec.encrypted.model,
        sessRec.encrypted.baseUrl
      );
    }

    // 3. Check if logged-in user is in OWNER_UIDS
    if (auth.uid && isUserInOwnerUids(auth.uid)) {
      if (requestedProvider === 'gemini' && process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY') {
        return factory('gemini', process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL);
      }
      if (requestedProvider === 'deepseek' && process.env.DEEPSEEK_API_KEY) {
        return factory('deepseek', process.env.DEEPSEEK_API_KEY, process.env.DEEPSEEK_MODEL);
      }
      if (requestedProvider === 'openai-compatible' && process.env.CUSTOM_OPENAI_API_KEY) {
        return factory(
          'openai-compatible',
          process.env.CUSTOM_OPENAI_API_KEY,
          process.env.CUSTOM_OPENAI_MODEL,
          process.env.CUSTOM_OPENAI_BASE_URL
        );
      }
    }

    // If user is a normal user or guest without personal key, block using owner key
    if (auth.uid && !isUserInOwnerUids(auth.uid)) {
      throw new SecurityError(
        'OWNER_KEY_FORBIDDEN',
        '普通用户未配置个人 API Key，且无权使用站长全局密钥。请在设置页配置个人模型密钥。',
        403
      );
    }

    throw new SecurityError(
      'MODEL_KEY_MISSING',
      `尚未配置 ${requestedProvider} 模型的有效 API Key，请前往「设置 → 模型与密钥」配置后重试。`,
      503
    );
  }

  // Static paper manifest & paper endpoints (always up-to-date after imports)
  router.get('/papers-manifest', (_req: Request, res: Response) => {
    // Prefer generated papers-manifest if present
    const genManifestPath = path.join(rootDir, 'data', 'exams', 'generated', 'papers-manifest.json');
    if (fs.existsSync(genManifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(genManifestPath, 'utf8'));
      res.status(200).json({ data: manifest });
      return;
    }
    const manifestPath = path.join(rootDir, 'data', 'papers-manifest.json');
    if (!fs.existsSync(manifestPath)) {
      const built = runPaperBuildPipeline(rootDir);
      res.status(200).json({ data: built.manifest });
      return;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    res.status(200).json({ data: manifest });
  });

  router.get('/exams/generated/papers-manifest', (_req: Request, res: Response) => {
    const genManifestPath = path.join(rootDir, 'data', 'exams', 'generated', 'papers-manifest.json');
    if (fs.existsSync(genManifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(genManifestPath, 'utf8'));
      res.status(200).json({ data: manifest });
      return;
    }
    res.status(404).json({ error: { code: 'MANIFEST_NOT_FOUND', message: '未找到生成题库清单' } });
  });

  router.get('/exams/generated/papers/:year', (req: Request, res: Response) => {
    const year = Number(req.params.year);
    const filePath = path.join(rootDir, 'data', 'exams', 'generated', 'papers', `${year}.json`);
    if (fs.existsSync(filePath)) {
      const exam = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      res.status(200).json({ data: exam });
      return;
    }
    res.status(404).json({ error: { code: 'PAPER_NOT_FOUND', message: `未找到 ${year} 年生成试卷数据` } });
  });

  router.get('/papers/:year', (req: Request, res: Response) => {
    const year = Number(req.params.year);
    const genFilePath = path.join(rootDir, 'data', 'exams', 'generated', 'papers', `${year}.json`);
    if (fs.existsSync(genFilePath)) {
      const exam = JSON.parse(fs.readFileSync(genFilePath, 'utf8'));
      res.status(200).json({ data: exam });
      return;
    }
    const versionedPath = path.join(rootDir, 'data', 'papers', String(year), 'v1.json');
    if (fs.existsSync(versionedPath)) {
      const exam = JSON.parse(fs.readFileSync(versionedPath, 'utf8'));
      res.status(200).json({ data: exam });
      return;
    }
    res.status(404).json({ error: { code: 'PAPER_NOT_FOUND', message: `未找到 ${year} 年试卷数据` } });
  });

  router.get('/papers/:year/:version', (req: Request, res: Response) => {
    const year = Number(req.params.year);
    const version = String(req.params.version).replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(rootDir, 'data', 'papers', String(year), `${version}.json`);
    if (fs.existsSync(filePath)) {
      const exam = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      res.status(200).json({ data: exam });
      return;
    }
    // Fallback to generated paper if available
    const genFilePath = path.join(rootDir, 'data', 'exams', 'generated', 'papers', `${year}.json`);
    if (fs.existsSync(genFilePath)) {
      const exam = JSON.parse(fs.readFileSync(genFilePath, 'utf8'));
      res.status(200).json({ data: exam });
      return;
    }
    res.status(404).json({
      error: {
        code: 'PAPER_NOT_FOUND',
        message: `未找到 ${year} 年 (${version}) 试卷数据`,
        details: [],
      },
    });
  });

  router.get('/import-reports/:year/:version', (req: Request, res: Response) => {
    const year = Number(req.params.year);
    const version = String(req.params.version).replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(
      rootDir,
      'data',
      'import-reports',
      String(year),
      `${version}.json`
    );
    if (!fs.existsSync(filePath)) {
      res.status(404).json({
        error: {
          code: 'IMPORT_REPORT_NOT_FOUND',
          message: `未找到 ${year} 年 (${version}) 导入验证报告`,
          details: [],
        },
      });
      return;
    }
    const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.status(200).json({ data: report });
  });

  // 1. GET /api/v1/model-capabilities
  router.get('/model-capabilities', (_req: Request, res: Response) => {
    const capabilities: ModelCapabilities[] = [
      new GeminiProvider('placeholder').getCapabilities(),
      new DeepSeekProvider('placeholder').getCapabilities(),
      new OpenAICompatibleProvider('placeholder').getCapabilities(),
    ];
    res.status(200).json({ data: { providers: capabilities, defaultProvider: 'gemini' } });
  });

  // 2. GET /api/v1/provider-credentials
  router.get('/provider-credentials', async (req: Request, res: Response) => {
    const auth = await resolveAuthContext(req, res, false);
    if (!auth) return;
    if (!checkRateLimit(req, res, auth.uid)) return;

    const providers: ('gemini' | 'deepseek' | 'openai-compatible')[] = [
      'gemini',
      'deepseek',
      'openai-compatible',
    ];
    const statuses: ProviderCredentialStatus[] = providers.map((prov) => {
      if (auth.uid) {
        const enc = encryptedStore.get(`${auth.uid}:${prov}`);
        if (enc) {
          return {
            provider: prov,
            configured: true,
            storageMode: 'encrypted-firestore',
            maskedKey: enc.maskedKey,
            baseUrl: enc.baseUrl,
            model: enc.model,
            lastTestedAt: enc.lastTestedAt,
            lastTestStatus: enc.lastTestStatus,
          };
        }
      }

      const sess = sessionKeyStore.get(`${auth.sessionId}:${prov}`);
      if (sess) {
        return {
          provider: prov,
          configured: true,
          storageMode: 'session-cookie',
          maskedKey: sess.encrypted.maskedKey,
          baseUrl: sess.encrypted.baseUrl,
          model: sess.encrypted.model,
          lastTestedAt: sess.encrypted.lastTestedAt,
          lastTestStatus: sess.encrypted.lastTestStatus,
        };
      }

      const isOwner = isUserInOwnerUids(auth.uid);
      const hasOwnerEnv =
        isOwner &&
        ((prov === 'gemini' &&
          Boolean(process.env.GEMINI_API_KEY) &&
          process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY') ||
          (prov === 'deepseek' && Boolean(process.env.DEEPSEEK_API_KEY)) ||
          (prov === 'openai-compatible' && Boolean(process.env.CUSTOM_OPENAI_API_KEY)));

      const defaultModels: Record<string, string> = {
        gemini: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
        deepseek: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        'openai-compatible': process.env.CUSTOM_OPENAI_MODEL || 'gpt-4o-mini',
      };

      return {
        provider: prov,
        configured: hasOwnerEnv,
        storageMode: hasOwnerEnv ? 'owner-env' : 'none',
        maskedKey: hasOwnerEnv ? 'owner••••env' : null,
        model: defaultModels[prov],
        lastTestedAt: null,
        lastTestStatus: 'untested',
      };
    });

    res.status(200).json({ data: { credentials: statuses } });
  });

  // 3. POST /api/v1/provider-credentials
  router.post('/provider-credentials', async (req: Request, res: Response) => {
    const auth = await resolveAuthContext(req, res, false);
    if (!auth) return;
    if (!checkRateLimit(req, res, auth.uid)) return;

    const { provider, apiKey, model, baseUrl, storageMode } = req.body || {};
    if (!['gemini', 'deepseek', 'openai-compatible'].includes(provider)) {
      res.status(400).json({
        error: {
          code: 'INVALID_PROVIDER',
          message: '不支持的模型提供商，仅支持 gemini | deepseek | openai-compatible',
          details: [],
        },
      });
      return;
    }

    if (typeof apiKey !== 'string' || apiKey.trim().length < 6) {
      res.status(400).json({
        error: {
          code: 'INVALID_API_KEY',
          message: '请输入有效的 API Key',
          details: [],
        },
      });
      return;
    }

    try {
      let validatedBaseUrl: string | undefined;
      if (provider === 'openai-compatible' || baseUrl) {
        validatedBaseUrl = await validateSafeCustomBaseUrl(
          baseUrl || 'https://api.openai.com/v1'
        );
      }

      const resolvedModel =
        (typeof model === 'string' && model.trim()) ||
        (provider === 'gemini'
          ? 'gemini-3.8-flash'
          : provider === 'deepseek'
          ? 'deepseek-chat'
          : 'gpt-4o-mini');

      if (storageMode === 'encrypted-firestore') {
        if (!auth.uid) {
          res.status(401).json({
            error: {
              code: 'UNAUTHENTICATED',
              message: '加密云端保存模式需要先登录账号；访客模式下请选择“仅本次会话”',
              details: [],
            },
          });
          return;
        }
        const encrypted = encryptProviderApiKey(auth.uid, provider, apiKey, {
          model: resolvedModel,
          baseUrl: validatedBaseUrl,
        });
        encryptedStore.set(`${auth.uid}:${provider}`, encrypted);

        const status: ProviderCredentialStatus = {
          provider,
          configured: true,
          storageMode: 'encrypted-firestore',
          maskedKey: encrypted.maskedKey,
          baseUrl: encrypted.baseUrl,
          model: encrypted.model,
          lastTestedAt: encrypted.lastTestedAt,
          lastTestStatus: encrypted.lastTestStatus,
        };
        res.status(201).json({ data: { credential: status } });
        return;
      }

      // Default: session-cookie (HttpOnly session storage)
      const ownerId = auth.uid || auth.sessionId;
      const encrypted = encryptProviderApiKey(ownerId, provider, apiKey, {
        model: resolvedModel,
        baseUrl: validatedBaseUrl,
      });
      sessionKeyStore.set(`${auth.sessionId}:${provider}`, {
        provider,
        encrypted,
      });

      const status: ProviderCredentialStatus = {
        provider,
        configured: true,
        storageMode: 'session-cookie',
        maskedKey: maskApiKey(apiKey),
        baseUrl: validatedBaseUrl,
        model: resolvedModel,
        lastTestedAt: null,
        lastTestStatus: 'untested',
      };
      res.status(201).json({ data: { credential: status } });
    } catch (err: any) {
      const code = err instanceof SecurityError ? err.code : 'CREDENTIAL_SAVE_FAILED';
      const status = err instanceof SecurityError ? err.status : 400;
      res.status(status).json({
        error: {
          code,
          message: err.message || '保存模型密钥失败',
          details: [],
        },
      });
    }
  });

  // 4. DELETE /api/v1/provider-credentials/:provider
  router.delete('/provider-credentials/:provider', async (req: Request, res: Response) => {
    const auth = await resolveAuthContext(req, res, false);
    if (!auth) return;

    const provider = req.params.provider as 'gemini' | 'deepseek' | 'openai-compatible';
    if (auth.uid) {
      encryptedStore.delete(`${auth.uid}:${provider}`);
    }
    sessionKeyStore.delete(`${auth.sessionId}:${provider}`);

    res.status(200).json({
      data: {
        provider,
        deleted: true,
      },
    });
  });

  // 5. POST /api/v1/model-tests
  router.post('/model-tests', async (req: Request, res: Response) => {
    const auth = await resolveAuthContext(req, res, false);
    if (!auth) return;
    if (!checkRateLimit(req, res, auth.uid)) return;

    const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    const { provider = 'gemini', useOwnerKey = false } = req.body || {};
    const start = Date.now();

    try {
      const activeProvider = resolveActiveProvider(auth, provider, Boolean(useOwnerKey));
      const result = await activeProvider.testConnection();

      // Update lastTestedAt status
      const nowIso = new Date().toISOString();
      if (auth.uid && encryptedStore.has(`${auth.uid}:${provider}`)) {
        const rec = encryptedStore.get(`${auth.uid}:${provider}`)!;
        rec.lastTestedAt = nowIso;
        rec.lastTestStatus = result.ok ? 'success' : 'failed';
      }
      if (sessionKeyStore.has(`${auth.sessionId}:${provider}`)) {
        const rec = sessionKeyStore.get(`${auth.sessionId}:${provider}`)!;
        rec.encrypted.lastTestedAt = nowIso;
        rec.encrypted.lastTestStatus = result.ok ? 'success' : 'failed';
      }

      auditLogs.push(
        createRedactedLogEntry({
          requestId,
          uid: auth.uid,
          provider: activeProvider.providerId,
          model: activeProvider.modelName,
          status: 'success',
          latencyMs: Date.now() - start,
        })
      );

      res.status(200).json({ data: result });
    } catch (err: any) {
      const code = err instanceof SecurityError ? err.code : 'MODEL_TEST_FAILED';
      const status = err instanceof SecurityError ? err.status : 502;
      auditLogs.push(
        createRedactedLogEntry({
          requestId,
          uid: auth.uid,
          provider: String(provider),
          model: 'unknown',
          status: 'error',
          latencyMs: Date.now() - start,
          errorCode: code,
        })
      );
      res.status(status).json({
        error: {
          code,
          message: err.message || '模型连接测试失败',
          details: [],
        },
      });
    }
  });

  // 6. POST /api/v1/imports & GET /api/v1/imports/:id
  router.post('/imports', async (req: Request, res: Response) => {
    const auth = await resolveAuthContext(req, res, false);
    if (!auth) return;
    if (!checkRateLimit(req, res, auth.uid)) return;

    const {
      year = 2010,
      fileName,
      contentBase64,
      markdownText,
    } = req.body || {};

    try {
      const supplementFiles: { year: number; fileName: string; buffer: Buffer }[] = [];

      if (fileName && (contentBase64 || markdownText)) {
        const buf = contentBase64
          ? Buffer.from(String(contentBase64), 'base64')
          : Buffer.from(String(markdownText), 'utf8');
        supplementFiles.push({
          year: Number(year),
          fileName: String(fileName),
          buffer: buf,
        });
      } else {
        res.status(400).json({
          error: {
            code: 'MISSING_IMPORT_SOURCE',
            message: '请上传真题或答案来源文件（MD / PDF / DOCX / ZIP），或粘贴来源答案文本',
            details: [],
          },
        });
        return;
      }

      const result = runPaperBuildPipeline(rootDir, {
        forceNewVersionForYear: Number(year),
        supplementFiles,
      });

      const yearEntry = result.manifest.years.find((y) => y.year === Number(year));
      const importId = `imp-${year}-${Date.now()}`;
      const job: StoredImportJob = {
        id: importId,
        year: Number(year),
        dataVersion:
          yearEntry?.latestReadyVersion ||
          yearEntry?.latestCandidateVersion ||
          'v1',
        status: yearEntry?.validationStatus || 'failed',
        errorCodes: yearEntry?.errorCodes || [],
        missingObjectiveCount: yearEntry?.missingObjectiveCount || 0,
        createdAt: new Date().toISOString(),
      };
      importJobs.set(importId, job);

      res.status(201).json({
        data: {
          importJob: job,
          manifest: result.manifest,
        },
      });
    } catch (err: any) {
      if (err instanceof PipelineSecurityError) {
        const statusMap: Record<string, number> = {
          FILE_TOO_LARGE: 413,
          ZIP_BOMB_DETECTED: 413,
          ILLEGAL_MIME_TYPE: 415,
          SPOOFED_EXTENSION: 415,
          DUPLICATE_FILE_HASH: 409,
          ZIP_PATH_TRAVERSAL: 400,
          UNSUPPORTED_EXTERNAL_RESOURCE: 422,
        };
        res.status(statusMap[err.code] || 400).json({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
        return;
      }
      res.status(422).json({
        error: {
          code: 'IMPORT_PIPELINE_FAILED',
          message: err.message || '真题导入校验失败',
          details: [],
        },
      });
    }
  });

  router.get('/imports/:id', (req: Request, res: Response) => {
    const job = importJobs.get(String(req.params.id));
    if (!job) {
      res.status(404).json({
        error: {
          code: 'IMPORT_JOB_NOT_FOUND',
          message: '未找到对应的导入任务记录',
          details: [],
        },
      });
      return;
    }
    res.status(200).json({ data: { importJob: job } });
  });

  // 7. POST /api/v1/evaluations (Subjective Two-Stage or Fast AI Grading)
  router.post('/evaluations', async (req: Request, res: Response) => {
    const auth = await resolveAuthContext(req, res, false);
    if (!auth) return;
    if (!checkRateLimit(req, res, auth.uid)) return;

    const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    if (idempotencyKey) {
      const scopedKey = `${auth.uid || auth.sessionId}:${idempotencyKey}`;
      if (inFlightKeys.has(scopedKey)) {
        res.status(409).json({
          error: {
            code: 'DUPLICATE_SUBMISSION_IN_FLIGHT',
            message: '相同幂等键的批改请求正在处理中，请勿重复提交',
            details: [],
          },
        });
        return;
      }
      if (idempotencyCache.has(scopedKey)) {
        const cached = idempotencyCache.get(scopedKey)!;
        res.status(cached.status).json(cached.body);
        return;
      }
      inFlightKeys.add(scopedKey);
      res.on('finish', () => inFlightKeys.delete(scopedKey));
    }

    const start = Date.now();
    const {
      provider = 'gemini',
      useOwnerKey = false,
      taskType,
      taskId,
      answerVersionId,
      evaluationMode = 'deep-two-stage',
      usedHints = false,
      questionPrompt,
      userAnswer,
      requiredFacts,
      hasVisualMaterial,
    } = req.body || {};

    if (!taskType || !taskId || !answerVersionId || !questionPrompt || !userAnswer) {
      res.status(400).json({
        error: {
          code: 'INVALID_EVALUATION_REQUEST',
          message: '缺少必要的批改参数 (taskType, taskId, answerVersionId, questionPrompt, userAnswer)',
          details: [],
        },
      });
      return;
    }

    if (String(userAnswer).length > 15000) {
      res.status(413).json({
        error: {
          code: 'INPUT_TOO_LARGE',
          message: '作答文本长度超过安全上限',
          details: [],
        },
      });
      return;
    }

    try {
      const activeProvider = resolveActiveProvider(auth, provider, Boolean(useOwnerKey));
      const evaluation = await runTwoStageSubjectiveEvaluation(activeProvider, {
        taskType,
        taskId,
        answerVersionId,
        evaluationMode,
        usedHints: Boolean(usedHints),
        questionPrompt,
        userAnswer,
        requiredFacts,
        hasVisualMaterial: Boolean(hasVisualMaterial),
      });

      evaluationCache.set(evaluation.id, {
        evaluation,
        questionPrompt,
        userAnswer,
        requiredFacts,
        ownerUid: auth.uid,
      });

      auditLogs.push(
        createRedactedLogEntry({
          requestId,
          uid: auth.uid,
          provider: activeProvider.providerId,
          model: activeProvider.modelName,
          status: 'success',
          latencyMs: Date.now() - start,
          // Even if userAnswer was passed here, createRedactedLogEntry strips it
          userAnswer,
        })
      );

      const responseBody = { data: { evaluation } };
      if (idempotencyKey) {
        idempotencyCache.set(`${auth.uid || auth.sessionId}:${idempotencyKey}`, {
          status: 201,
          body: responseBody,
        });
      }
      res.status(201).json(responseBody);
    } catch (err: any) {
      const code = err instanceof SecurityError ? err.code : 'EVALUATION_FAILED';
      const status = err instanceof SecurityError ? err.status : 502;
      auditLogs.push(
        createRedactedLogEntry({
          requestId,
          uid: auth.uid,
          provider: String(provider),
          model: 'unknown',
          status: 'error',
          latencyMs: Date.now() - start,
          errorCode: code,
        })
      );
      res.status(status).json({
        error: {
          code,
          message: err.message || 'AI 批改请求失败',
          details: [],
        },
      });
    }
  });

  // 8. POST /api/v1/evaluation-reviews (Stage 2 Re-Review without re-running Stage 1)
  router.post('/evaluation-reviews', async (req: Request, res: Response) => {
    const auth = await resolveAuthContext(req, res, false);
    if (!auth) return;
    if (!checkRateLimit(req, res, auth.uid)) return;

    const {
      provider = 'gemini',
      evaluationId,
      stage1Evaluation,
      questionPrompt,
      userAnswer,
      requiredFacts,
    } = req.body || {};

    const cached = evaluationId ? evaluationCache.get(evaluationId) : undefined;
    if (cached && cached.ownerUid && cached.ownerUid !== auth.uid) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN_USER_MISMATCH',
          message: '无权复核其他用户的批改记录',
          details: [],
        },
      });
      return;
    }

    const targetEval: SubjectiveEvaluationResult | undefined =
      cached?.evaluation || stage1Evaluation;
    const targetPrompt: string | undefined = cached?.questionPrompt || questionPrompt;
    const targetAnswer: string | undefined = cached?.userAnswer || userAnswer;

    if (!targetEval || !targetPrompt || !targetAnswer) {
      res.status(404).json({
        error: {
          code: 'EVALUATION_NOT_FOUND',
          message: '未找到待复核的第一阶段批改结果',
          details: [],
        },
      });
      return;
    }

    try {
      const activeProvider = resolveActiveProvider(auth, provider, false);
      const reviewed = await runStage2ReviewOnly(
        activeProvider,
        targetEval,
        targetPrompt,
        targetAnswer,
        cached?.requiredFacts || requiredFacts
      );
      if (evaluationId && cached) {
        cached.evaluation = reviewed;
      }
      res.status(200).json({ data: { evaluation: reviewed } });
    } catch (err: any) {
      const code = err instanceof SecurityError ? err.code : 'STAGE2_REVIEW_FAILED';
      const status = err instanceof SecurityError ? err.status : 502;
      res.status(status).json({
        error: {
          code,
          message: err.message || '阶段二重新复核失败，第一阶段结果已保留',
          details: [],
        },
      });
    }
  });

  // 9. POST /api/v1/objective-analyses
  router.post('/objective-analyses', async (req: Request, res: Response) => {
    const auth = await resolveAuthContext(req, res, false);
    if (!auth) return;
    if (!checkRateLimit(req, res, auth.uid)) return;

    const {
      provider = 'gemini',
      questionNumber,
      passageText,
      questionPrompt,
      options,
      correctAnswer,
      userSelectedAnswer,
    } = req.body || {};

    if (!questionNumber || !passageText || !questionPrompt || !correctAnswer) {
      res.status(400).json({
        error: {
          code: 'INVALID_OBJECTIVE_ANALYSIS_REQUEST',
          message: '缺少客观题解析所需参数',
          details: [],
        },
      });
      return;
    }

    try {
      const activeProvider = resolveActiveProvider(auth, provider, false);
      const analysis = await runObjectiveQuestionAnalysis(activeProvider, {
        questionNumber: Number(questionNumber),
        passageText: String(passageText),
        questionPrompt: String(questionPrompt),
        options: Array.isArray(options) ? options : [],
        correctAnswer: String(correctAnswer),
        userSelectedAnswer: String(userSelectedAnswer || ''),
      });
      res.status(200).json({ data: { analysis } });
    } catch (err: any) {
      const code = err instanceof SecurityError ? err.code : 'OBJECTIVE_ANALYSIS_FAILED';
      const status = err instanceof SecurityError ? err.status : 502;
      res.status(status).json({
        error: {
          code,
          message: err.message || '客观题 AI 解析请求失败',
          details: [],
        },
      });
    }
  });

  // 10. POST /api/v1/follow-up-analyses
  router.post('/follow-up-analyses', async (req: Request, res: Response) => {
    const auth = await resolveAuthContext(req, res, false);
    if (!auth) return;
    if (!checkRateLimit(req, res, auth.uid)) return;

    const {
      provider = 'gemini',
      questionNumber,
      questionContext,
      userAnswer,
      existingAnalysisSummary,
      userQuestion,
    } = req.body || {};

    if (!questionNumber || !userQuestion) {
      res.status(400).json({
        error: {
          code: 'INVALID_FOLLOW_UP_REQUEST',
          message: '缺少当前题号或追问内容',
          details: [],
        },
      });
      return;
    }

    try {
      const activeProvider = resolveActiveProvider(auth, provider, false);
      const result = await runFollowUpAnalysis(activeProvider, {
        questionNumber: Number(questionNumber),
        questionContext: String(questionContext || ''),
        userAnswer: String(userAnswer || ''),
        existingAnalysisSummary: String(existingAnalysisSummary || ''),
        userQuestion: String(userQuestion),
      });
      res.status(200).json({ data: result });
    } catch (err: any) {
      const code = err instanceof SecurityError ? err.code : 'FOLLOW_UP_FAILED';
      const status = err instanceof SecurityError ? err.status : 502;
      res.status(status).json({
        error: {
          code,
          message: err.message || 'AI 追问失败',
          details: [],
        },
      });
    }
  });

  return { router, auditLogs, encryptedStore };
}
