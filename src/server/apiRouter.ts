import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { runPaperBuildPipeline } from '../pipeline/buildPipeline.ts';
import {
  auditExamItemDataQuality,
  stripUnreleasedAnswerFields,
} from '../shared/schemaValidator.ts';
import type {
  AITaskType,
  DataQualityConflictInfo,
  EvaluationRun,
  Exam,
  ExamItem,
  ExamUnit,
  FollowUpTurn,
  ItemRubric,
  ModelCapabilities,
  ProviderType,
  SubjectiveEvaluationResult,
  TaskBindingConfig,
} from '../shared/types.ts';
import {
  PROMPT_VERSION,
  runContextualFollowUpAnalysis,
  runObjectiveItemAnalysis,
  runTwoStageSubjectiveEvaluation,
  runWritingScaffoldGeneration,
} from './aiEvaluators.ts';
import {
  type MultimodalImageInput,
  createModelProvider,
} from './modelProviders.ts';
import {
  ALL_AI_TASK_TYPES,
  PersistentAIStore,
  computeCompositeIdempotencyKey,
} from './persistentStore.ts';
import {
  SecurityError,
  computeConfigurationHash,
  createRedactedLogEntry,
  isUserInOwnerUids,
  loadVerifiedExamImageAsset,
  normalizeProviderBaseUrl,
  normalizeToAIError,
  validateSafeCustomBaseUrl,
} from './securityAndCrypto.ts';

export interface ApiV1RouterOptions {
  rootDir?: string;
  storeFilePath?: string;
  rateLimitMaxPerMinute?: number;
  verifyIdTokenFn?: (
    token: string
  ) => Promise<{ uid: string; email?: string; email_verified?: boolean }>;
  dnsLookupFn?: (hostname: string) => Promise<{ address: string }[]>;
}

const VALID_PROVIDERS: ProviderType[] = ['gemini', 'deepseek', 'openai-compatible'];

function normalizeProviderInput(raw: unknown): ProviderType {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'gemini') return 'gemini';
  if (s === 'deepseek') return 'deepseek';
  if (s === 'openai-compatible' || s === 'openai_compatible') return 'openai-compatible';
  throw new SecurityError('INVALID_PROVIDER', `不支持的模型供应商: ${String(raw)}`, 400);
}

export function createApiV1Router(options: ApiV1RouterOptions = {}): {
  router: express.Router;
  store: PersistentAIStore;
} {
  const router = express.Router();
  router.use(express.json({ limit: '4mb' }));

  const rootDir = options.rootDir || process.cwd();
  const store = new PersistentAIStore(options.storeFilePath);
  const maxPerMinute = options.rateLimitMaxPerMinute ?? 60;

  // Rate limit buckets: key -> timestamps[]
  const rateBuckets = new Map<string, number[]>();

  function checkRateLimit(uidOrIp: string, res: Response): boolean {
    const now = Date.now();
    const windowMs = 60 * 1000;
    const prev = (rateBuckets.get(uidOrIp) || []).filter((t) => now - t < windowMs);
    if (prev.length >= maxPerMinute) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({
        error: {
          code: 'PROVIDER_RATE_LIMITED',
          message: '请求过于频繁，请稍后再试',
        },
      });
      return false;
    }
    prev.push(now);
    rateBuckets.set(uidOrIp, prev);
    return true;
  }

  /**
   * Resolves caller identity:
   * - If Bearer token is present and verifyIdTokenFn is configured, verifies the Firebase ID token.
   * - If client passes a spoofed `userId` in query/body that differs from the verified token uid, throws 403 FORBIDDEN_USER_MISMATCH.
   * - In local workstation mode (no verifyIdTokenFn configured), falls back to `'local-guest'`.
   */
  async function resolveCallerUid(req: Request): Promise<{
    uid: string;
    email?: string;
    authenticated: boolean;
  }> {
    const authHeader = req.headers.authorization;
    let resolvedUid = 'local-guest';
    let resolvedEmail: string | undefined;
    let authenticated = false;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      if (token && token !== 'local-guest-token') {
        if (options.verifyIdTokenFn) {
          try {
            const decoded = await options.verifyIdTokenFn(token);
            resolvedUid = decoded.uid;
            resolvedEmail = decoded.email;
            authenticated = true;
          } catch {
            throw new SecurityError(
              'AUTH_TOKEN_INVALID',
              '身份认证 Token 无效或已过期，请重新登录',
              401
            );
          }
        }
      }
    } else if (options.verifyIdTokenFn) {
      // When verifyIdTokenFn is strictly configured and no guest header is passed on protected routes
      const requestedUserId =
        (req.query?.userId as string) || (req.body && (req.body.userId as string));
      if (requestedUserId) {
        throw new SecurityError('AUTH_REQUIRED', '访问用户专属配置需提供身份认证凭证', 401);
      }
    }

    // Check against cross-user spoofing in query or body
    const explicitUserId =
      (typeof req.query?.userId === 'string' ? req.query.userId.trim() : '') ||
      (req.body && typeof req.body.userId === 'string' ? req.body.userId.trim() : '');

    if (explicitUserId && explicitUserId !== resolvedUid) {
      throw new SecurityError(
        'FORBIDDEN_USER_MISMATCH',
        '禁止跨用户访问或操作他人配置与学习记录',
        403
      );
    }

    return { uid: resolvedUid, email: resolvedEmail, authenticated };
  }

  function loadGeneratedExam(year: number): Exam | null {
    const candidates = [
      path.join(rootDir, 'data', 'exams', 'generated', 'papers', `${year}.json`),
      path.join(rootDir, 'public', 'data', 'exams', 'generated', 'papers', `${year}.json`),
      path.join(rootDir, 'data', 'papers', String(year), 'v2.json'),
      path.join(rootDir, 'data', 'papers', String(year), 'v1.json'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          return JSON.parse(fs.readFileSync(p, 'utf8')) as Exam;
        } catch {
          // continue
        }
      }
    }
    return null;
  }

  function attachDataQualityAuditToExam(exam: Exam): Exam {
    const cloned: Exam = structuredClone(exam);
    const paperSource = cloned.sourceFiles?.[0] || `data/exams/raw/papers/${cloned.year}.md`;
    const answerSource = `data/exams/raw/answers/${cloned.year}.md`;
    const disputedList: NonNullable<Exam['validationReport']['disputedQuestions']> = [];

    for (const sec of cloned.sections) {
      for (const unit of sec.units) {
        const passageText = unit.materials.map((m) => m.text).join('\n\n');
        for (const item of unit.items) {
          const audit = auditExamItemDataQuality(
            cloned.year,
            item,
            passageText,
            paperSource,
            answerSource
          );
          item.dataQuality = audit;
          if (audit.status === 'disputed') {
            disputedList.push({
              questionNumber: item.questionNumber,
              markedAnswer: audit.markedAnswer,
              semanticCandidateAnswer: audit.semanticCandidateAnswer,
              reason: audit.reason,
              paperSourceFile: audit.paperSourceFile,
              answerSourceFile: audit.answerSourceFile,
            });
          }
        }
      }
    }

    if (cloned.validationReport) {
      cloned.validationReport.disputedQuestions = disputedList;
    }
    return cloned;
  }

  // ============================================================================
  // 1. Papers Manifest & Exam Data Endpoints
  // ============================================================================
  router.get('/papers-manifest', (_req: Request, res: Response) => {
    const candidates = [
      path.join(rootDir, 'data', 'exams', 'generated', 'papers-manifest.json'),
      path.join(rootDir, 'public', 'data', 'papers-manifest.json'),
      path.join(rootDir, 'data', 'papers-manifest.json'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          const data = JSON.parse(fs.readFileSync(p, 'utf8'));
          res.json({ data });
          return;
        } catch {
          // continue
        }
      }
    }
    res.status(404).json({ error: { code: 'MANIFEST_NOT_FOUND', message: '未找到题库清单' } });
  });

  router.get('/exams/generated/papers/:year', async (req: Request, res: Response) => {
    try {
      const year = Number(req.params.year);
      const exam = loadGeneratedExam(year);
      if (!exam) {
        res.status(404).json({ error: { code: 'EXAM_NOT_FOUND', message: `未找到 ${year} 年真题` } });
        return;
      }
      const auditedExam = attachDataQualityAuditToExam(exam);
      res.json({ data: auditedExam });
    } catch (err) {
      const norm = normalizeToAIError(err);
      res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
    }
  });

  router.get('/papers/:year/:version', (req: Request, res: Response) => {
    const { year, version } = req.params;
    const candidates = [
      path.join(rootDir, 'data', 'papers', year, `${version}.json`),
      path.join(rootDir, 'public', 'data', 'papers', year, `${version}.json`),
      path.join(rootDir, 'data', 'exams', 'generated', 'papers', `${year}.json`),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          const exam = attachDataQualityAuditToExam(
            JSON.parse(fs.readFileSync(p, 'utf8')) as Exam
          );
          res.json({ data: exam });
          return;
        } catch {
          // continue
        }
      }
    }
    res.status(404).json({ error: { code: 'PAPER_NOT_FOUND', message: '未找到指定版本试卷' } });
  });

  router.get('/import-reports/:year/:version', (req: Request, res: Response) => {
    const { year, version } = req.params;
    const candidates = [
      path.join(rootDir, 'data', 'import-reports', year, `${version}.json`),
      path.join(rootDir, 'public', 'data', 'import-reports', year, `${version}.json`),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        res.json({ data: JSON.parse(fs.readFileSync(p, 'utf8')) });
        return;
      }
    }
    const exam = loadGeneratedExam(Number(year));
    if (exam?.validationReport) {
      res.json({ data: exam.validationReport });
      return;
    }
    res.status(404).json({ error: { code: 'REPORT_NOT_FOUND', message: '未找到校验报告' } });
  });

  router.post('/imports', (req: Request, res: Response) => {
    try {
      const { year, fileName, markdownText, contentBase64 } = req.body || {};
      const buffer =
        typeof contentBase64 === 'string'
          ? Buffer.from(contentBase64, 'base64')
          : typeof markdownText === 'string'
          ? Buffer.from(markdownText, 'utf8')
          : undefined;
      const result = runPaperBuildPipeline(rootDir, {
        forceNewVersionForYear: year ? Number(year) : undefined,
        supplementFiles:
          year && fileName && buffer
            ? [
                {
                  year: Number(year),
                  fileName: String(fileName),
                  buffer,
                },
              ]
            : undefined,
      });
      res.json({ data: result });
    } catch (err) {
      const norm = normalizeToAIError(err);
      res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
    }
  });

  router.post(['/exams/:year/submit', '/exams/:year/submit-attempt'], async (req: Request, res: Response) => {
    try {
      const caller = await resolveCallerUid(req);
      const year = Number(req.params.year);
      const attemptId = String(req.body?.attemptId || `attempt-${year}`);
      const submittedQuestions = Array.isArray(req.body?.submittedQuestions)
        ? req.body.submittedQuestions.map(Number)
        : undefined;
      const record = store.markAttemptSubmitted({
        ownerUid: caller.uid,
        attemptId,
        year,
        submittedQuestions,
        submittedAll: req.body?.submittedAll !== false,
      });
      res.json({ ok: true, data: record });
    } catch (err) {
      const norm = normalizeToAIError(err);
      res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
    }
  });

  // ============================================================================
  // 2. Provider Credentials & Four-Layer AI Workspace Configuration
  // ============================================================================
  router.get('/provider-credentials', async (req: Request, res: Response) => {
    try {
      const caller = await resolveCallerUid(req);
      if (!checkRateLimit(caller.uid, res)) return;

      const credentials = store.getProviderCredentialStatuses(caller.uid);
      const workspace = store.getWorkspace(caller.uid);
      res.json({
        data: {
          credentials,
          workspace,
        },
        credentials,
        workspace,
      });
    } catch (err) {
      const norm = normalizeToAIError(err);
      res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
    }
  });

  router.post('/provider-credentials', async (req: Request, res: Response) => {
    try {
      const caller = await resolveCallerUid(req);
      if (!checkRateLimit(caller.uid, res)) return;

      const {
        connectionId,
        provider: rawProvider,
        displayName,
        apiKey,
        baseUrl,
        model,
        modelSource,
        storageMode,
        setAsDefault,
        verifiedCapabilities,
        capabilitySource,
      } = req.body || {};

      const provider = normalizeProviderInput(rawProvider);
      const modelId =
        typeof model === 'string' && model.trim()
          ? model.trim()
          : provider === 'gemini'
          ? 'gemini-2.5-flash'
          : provider === 'deepseek'
          ? 'deepseek-chat'
          : '';

      if (!modelId) {
        throw new SecurityError(
          'MODEL_NOT_FOUND',
          '请从模型列表中选择模型或手动填写模型 ID（请求中的 model 字段）',
          400
        );
      }

      let normalizedBase = normalizeProviderBaseUrl(provider, baseUrl);
      if (baseUrl && typeof baseUrl === 'string' && baseUrl.trim()) {
        normalizedBase = await validateSafeCustomBaseUrl(normalizedBase, options.dnsLookupFn);
      }

      const effectiveStorageMode: 'persistent-encrypted' | 'session-only' =
        storageMode === 'session-cookie' || storageMode === 'session-only'
          ? 'session-only'
          : 'persistent-encrypted';

      const saved = store.upsertConnectionAndProfile({
        ownerUid: caller.uid,
        connectionId: typeof connectionId === 'string' ? connectionId : undefined,
        providerType: provider,
        displayName: typeof displayName === 'string' ? displayName : undefined,
        baseUrl: normalizedBase,
        apiKey: typeof apiKey === 'string' ? apiKey : undefined,
        storageMode: effectiveStorageMode,
        modelId,
        modelSource: modelSource === 'provider-list' ? 'provider-list' : 'manual',
        verifiedCapabilities,
        capabilitySource,
        setAsDefault: setAsDefault !== false,
      });

      const credentials = store.getProviderCredentialStatuses(caller.uid);

      res.status(201).json({
        ok: true,
        data: {
          credential: {
            provider,
            connectionId: saved.connection.id,
            profileId: saved.profile.id,
            maskedKey: saved.connection.maskedKey,
            model: saved.profile.modelId,
            baseUrl: saved.connection.baseUrl,
            storageMode:
              effectiveStorageMode === 'session-only'
                ? 'session-cookie'
                : 'encrypted-firestore',
            configurationHash: saved.connection.configurationHash,
          },
          credentials,
          workspace: saved.workspace,
        },
      });
    } catch (err) {
      const norm = normalizeToAIError(err);
      res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
    }
  });

  router.delete('/provider-credentials/:providerOrConnectionId', async (req: Request, res: Response) => {
    try {
      const caller = await resolveCallerUid(req);
      if (!checkRateLimit(caller.uid, res)) return;

      const targetRaw = req.params.providerOrConnectionId;
      const target =
        targetRaw === 'openai_compatible' ? 'openai-compatible' : targetRaw;
      const force = req.query.force !== 'false';

      const result = store.deleteConnection(caller.uid, target, force);
      res.json({
        ok: true,
        data: {
          deleted: result.deleted,
          affectedTasks: result.affectedTasks,
          credentials: store.getProviderCredentialStatuses(caller.uid),
          workspace: store.getWorkspace(caller.uid),
        },
      });
    } catch (err) {
      const norm = normalizeToAIError(err);
      res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
    }
  });

  // ============================================================================
  // 3. Model Discovery (Mode A: List Models) & Multi-Layer Capability Probe
  // ============================================================================
  async function handleDiscoverProviderModels(req: Request, res: Response): Promise<void> {
    try {
      const caller = await resolveCallerUid(req);
      if (!checkRateLimit(caller.uid, res)) return;

      const rawProvider = req.body?.provider || req.query.provider;
      const provider = normalizeProviderInput(rawProvider);
      const connectionId = (req.body?.connectionId || req.query.connectionId) as
        | string
        | undefined;
      const tempApiKey =
        typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
      const rawBaseUrl =
        typeof (req.body?.baseUrl ?? req.query.baseUrl) === 'string'
          ? String(req.body?.baseUrl ?? req.query.baseUrl).trim()
          : '';
      const forceRefresh =
        req.body?.forceRefresh === true || req.query.forceRefresh === 'true';

      let effectiveApiKey = tempApiKey;
      let effectiveBaseUrl = rawBaseUrl;

      if (!effectiveApiKey) {
        const cred =
          (connectionId ? store.getDecryptedCredential(caller.uid, connectionId) : null) ||
          store.getDecryptedCredential(caller.uid, provider);
        if (!cred) {
          throw new SecurityError(
            'PROVIDER_CREDENTIAL_MISSING',
            `请先输入 ${provider} 的 API Key 或选择已保存的连接后再拉取模型列表`,
            400
          );
        }
        effectiveApiKey = cred.plainKey;
        if (!effectiveBaseUrl && cred.record.baseUrl) {
          effectiveBaseUrl = cred.record.baseUrl;
        }
      }

      let normalizedBase = normalizeProviderBaseUrl(provider, effectiveBaseUrl || undefined);
      if (effectiveBaseUrl) {
        normalizedBase = await validateSafeCustomBaseUrl(normalizedBase, options.dnsLookupFn);
      }

      const adapter = createModelProvider({
        provider,
        apiKey: effectiveApiKey,
        baseUrl: normalizedBase,
        dnsLookupFn: options.dnsLookupFn,
      });

      const discovery = await adapter.discoverModels!({ forceRefresh });
      res.json({
        ok: true,
        data: discovery,
        ...discovery,
      });
    } catch (err) {
      const norm = normalizeToAIError(err);
      res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
    }
  }

  router.get('/provider-models', handleDiscoverProviderModels);
  router.post('/provider-models', handleDiscoverProviderModels);

  router.post('/model-tests', async (req: Request, res: Response) => {
    try {
      const caller = await resolveCallerUid(req);
      if (!checkRateLimit(caller.uid, res)) return;

      const {
        provider: rawProvider,
        connectionId,
        apiKey: tempApiKey,
        baseUrl: tempBaseUrl,
        model: requestedModel,
        useOwnerKey,
        layers,
      } = req.body || {};

      const provider = normalizeProviderInput(rawProvider);

      if (useOwnerKey) {
        if (!isUserInOwnerUids(caller.authenticated ? caller.uid : null)) {
          throw new SecurityError(
            'OWNER_KEY_FORBIDDEN',
            '当前登录账号不在 OWNER_UIDS 白名单内，禁止调用服务端内置测试密钥',
            403
          );
        }
      }

      let effectiveApiKey = typeof tempApiKey === 'string' ? tempApiKey.trim() : '';
      let effectiveBaseUrl = typeof tempBaseUrl === 'string' ? tempBaseUrl.trim() : '';
      let effectiveModel = typeof requestedModel === 'string' ? requestedModel.trim() : '';

      if (!effectiveApiKey) {
        const saved =
          (connectionId ? store.getDecryptedCredential(caller.uid, connectionId) : null) ||
          store.getDecryptedCredential(caller.uid, provider);
        if (!saved) {
          throw new SecurityError(
            'PROVIDER_CREDENTIAL_MISSING',
            `尚未保存 ${provider} 密钥，请在输入框填写 API Key 后再执行测试`,
            400
          );
        }
        effectiveApiKey = saved.plainKey;
        if (!effectiveBaseUrl && saved.record.baseUrl) {
          effectiveBaseUrl = saved.record.baseUrl;
        }
        if (!effectiveModel && saved.record.model) {
          effectiveModel = saved.record.model;
        }
      }

      if (!effectiveModel) {
        effectiveModel =
          provider === 'gemini'
            ? 'gemini-2.5-flash'
            : provider === 'deepseek'
            ? 'deepseek-chat'
            : '';
      }

      if (!effectiveModel) {
        throw new SecurityError(
          'MODEL_NOT_FOUND',
          '请先选择或手动填写目标模型 ID 后再进行连接测试',
          400
        );
      }

      let normalizedBase = normalizeProviderBaseUrl(provider, effectiveBaseUrl || undefined);
      if (effectiveBaseUrl) {
        normalizedBase = await validateSafeCustomBaseUrl(normalizedBase, options.dnsLookupFn);
      }

      const adapter = createModelProvider({
        provider,
        apiKey: effectiveApiKey,
        modelName: effectiveModel,
        baseUrl: normalizedBase,
        dnsLookupFn: options.dnsLookupFn,
      });

      const requestedLayers: ('basic' | 'structured' | 'vision' | 'sample')[] =
        Array.isArray(layers) && layers.length > 0
          ? layers
          : ['basic', 'structured'];

      const testRes = await adapter.testConnection({
        layers: requestedLayers,
        timeoutMs: 18000,
      });

      // Record test verification result if this matches a saved connection/profile
      if (testRes.multiLayerReport) {
        const layerMap: NonNullable<
          import('../shared/types.ts').ModelProfile['lastTestLayers']
        > = {};
        for (const l of testRes.multiLayerReport.layers) {
          layerMap[l.layer] = {
            ok: l.ok,
            latencyMs: l.latencyMs,
            testedAt: testRes.multiLayerReport.testedAt,
            message: l.message,
          };
        }
        store.recordTestResult({
          ownerUid: caller.uid,
          connectionId,
          providerType: provider,
          modelId: effectiveModel,
          configurationHash: testRes.multiLayerReport.configurationHash,
          ok: testRes.ok,
          testedAt: testRes.multiLayerReport.testedAt,
          verifiedCapabilities: testRes.multiLayerReport.verifiedCapabilities,
          capabilitySources: testRes.multiLayerReport.capabilitySources,
          layers: layerMap,
        });
      }

      res.json({
        ok: testRes.ok,
        data: {
          ok: testRes.ok,
          latencyMs: testRes.latencyMs,
          message: testRes.message,
          multiLayerReport: testRes.multiLayerReport,
          credentials: store.getProviderCredentialStatuses(caller.uid),
          workspace: store.getWorkspace(caller.uid),
        },
      });
    } catch (err) {
      const norm = normalizeToAIError(err);
      res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
    }
  });

  // ============================================================================
  // 4. AI Workspace & Task Routing Endpoints
  // ============================================================================
  router.get(['/ai-workspace', '/ai/workspace'], async (req: Request, res: Response) => {
    try {
      const caller = await resolveCallerUid(req);
      const workspace = store.getWorkspace(caller.uid);
      const credentials = store.getProviderCredentialStatuses(caller.uid);
      const runs = store.listEvaluationRuns(caller.uid, 25);
      res.json({
        ok: true,
        data: { workspace, credentials, runs },
        workspace,
        credentials,
        runs,
      });
    } catch (err) {
      const norm = normalizeToAIError(err);
      res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
    }
  });

  router.put('/ai-workspace/default-model', async (req: Request, res: Response) => {
    try {
      const caller = await resolveCallerUid(req);
      const { profileId } = req.body || {};
      if (!profileId || typeof profileId !== 'string') {
        throw new SecurityError('MODEL_NOT_FOUND', '请指定要设为默认的模型档案 ID', 400);
      }
      const workspace = store.setDefaultModelProfile(caller.uid, profileId);
      const credentials = store.getProviderCredentialStatuses(caller.uid);
      res.json({ ok: true, data: { workspace, credentials } });
    } catch (err) {
      const norm = normalizeToAIError(err);
      res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
    }
  });

  router.put('/ai-workspace/task-bindings', async (req: Request, res: Response) => {
    try {
      const caller = await resolveCallerUid(req);
      const { bindings } = req.body || {};
      if (!bindings || typeof bindings !== 'object') {
        throw new SecurityError('INTERNAL_CONFIGURATION_ERROR', '无效的任务路由参数', 400);
      }
      const workspace = store.updateTaskBindings(
        caller.uid,
        bindings as Partial<Record<AITaskType, Partial<TaskBindingConfig>>>
      );
      res.json({ ok: true, data: { workspace } });
    } catch (err) {
      const norm = normalizeToAIError(err);
      res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
    }
  });

  router.get('/model-capabilities', async (req: Request, res: Response) => {
    try {
      const caller = await resolveCallerUid(req);
      const ws = store.getWorkspace(caller.uid);
      const capabilities: ModelCapabilities[] = ws.modelProfiles.map((p) => ({
        provider: p.providerType,
        displayName: p.displayName,
        defaultModel: p.modelId,
        supportsVision: p.capabilities.vision,
        supportsJsonObject: p.capabilities.jsonObject,
        supportsJsonSchema: p.capabilities.jsonSchema,
        supportsStreaming: p.capabilities.streaming,
        supportsReasoning: p.capabilities.reasoning,
        maxInput: p.contextWindow || 65536,
        maxOutput: p.outputLimit || 8192,
        capabilitySource: p.capabilitySource.vision,
      }));
      res.json({
        data: {
          capabilities,
          defaultModelProfileId: ws.defaultModelProfileId,
          taskBindings: ws.taskBindings,
        },
      });
    } catch (err) {
      const norm = normalizeToAIError(err);
      res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
    }
  });

  // ============================================================================
  // 5. Two-Stage Subjective Evaluation (Translation, Practical & Visual Writing)
  // ============================================================================
  router.post('/evaluations', async (req: Request, res: Response) => {
    const startedAtIso = new Date().toISOString();
    const startMs = Date.now();
    try {
      const caller = await resolveCallerUid(req);
      if (!checkRateLimit(caller.uid, res)) return;

      const {
        provider: requestedProvider,
        modelProfileId: requestedProfileId,
        stage2ModelProfileId: requestedStage2ProfileId,
        taskType,
        taskId,
        year,
        answerVersionId,
        previousAnswerVersionId,
        previousVersionLabel,
        previousUserAnswer,
        previousEvaluation,
        evaluationMode,
        usedHints,
        questionPrompt,
        userAnswer,
        maxScore,
        rubric,
        requiredFacts,
        hasVisualMaterial,
        imagePaths,
        referenceText,
      } = req.body || {};

      if (!userAnswer || typeof userAnswer !== 'string' || userAnswer.trim().length < 3) {
        throw new SecurityError('STRUCTURED_OUTPUT_INVALID', '作答内容不能为空', 400);
      }

      const aiTaskType: AITaskType =
        taskType === 'visual-writing' ? 'visual_writing' : 'subjective_stage1';

      const stage1Resolved = store.resolveTaskModelBinding({
        ownerUid: caller.uid,
        taskType: aiTaskType,
        requestedProfileId,
        requestedProvider:
          requestedProvider && VALID_PROVIDERS.includes(requestedProvider)
            ? requestedProvider
            : undefined,
      });

      if (!stage1Resolved) {
        throw new SecurityError(
          'PROVIDER_CREDENTIAL_MISSING',
          `尚未为任务 [${aiTaskType}] 配置可用的 AI 模型连接，请前往「设置」添加并选择默认模型。`,
          400
        );
      }

      const stage2Resolved =
        store.resolveTaskModelBinding({
          ownerUid: caller.uid,
          taskType: 'subjective_stage2',
          requestedProfileId: requestedStage2ProfileId,
        }) || stage1Resolved;

      // Load real verified exam image assets for visual writing
      const loadedImages: MultimodalImageInput[] = [];
      const imageAssetsUsed: string[] = [];
      const imageHashes: string[] = [];

      const candidateImagePaths: string[] = Array.isArray(imagePaths) ? [...imagePaths] : [];
      const inferredYear =
        typeof year === 'number'
          ? year
          : typeof answerVersionId === 'string' && /ver-(\d{4})/.test(answerVersionId)
          ? Number(answerVersionId.match(/ver-(\d{4})/)![1])
          : undefined;

      if (
        (taskType === 'visual-writing' || hasVisualMaterial) &&
        candidateImagePaths.length === 0 &&
        inferredYear
      ) {
        const exam = loadGeneratedExam(inferredYear);
        if (exam) {
          const vwUnit = exam.sections
            .flatMap((s) => s.units)
            .find((u) => u.unitType === 'visual-writing');
          for (const mat of vwUnit?.materials || []) {
            if (mat.imagePath) candidateImagePaths.push(mat.imagePath);
            for (const vm of mat.visualMaterials || []) {
              if (vm.imagePath && !candidateImagePaths.includes(vm.imagePath)) {
                candidateImagePaths.push(vm.imagePath);
              }
            }
          }
        }
      }

      for (const relPath of candidateImagePaths) {
        try {
          const verifiedImg = loadVerifiedExamImageAsset(rootDir, relPath);
          loadedImages.push({
            mimeType: verifiedImg.mimeType,
            base64Data: verifiedImg.base64Data,
          });
          imageAssetsUsed.push(verifiedImg.relativePath);
          imageHashes.push(verifiedImg.sha256.slice(0, 12));
        } catch {
          // Skip missing/unreadable image while recording fallback
        }
      }

      // Compute Composite Idempotency Key (includes inputHash, rubricHash, promptVersion, modelId, imageHash)
      const inputHash = crypto
        .createHash('sha256')
        .update(`${taskId}:${userAnswer.trim()}:${questionPrompt || ''}`)
        .digest('hex')
        .slice(0, 20);
      const rubricHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(rubric || requiredFacts || 'default-rubric'))
        .digest('hex')
        .slice(0, 16);
      const prevHash = previousUserAnswer
        ? crypto.createHash('sha256').update(previousUserAnswer).digest('hex').slice(0, 12)
        : 'none';

      const compositeKey = computeCompositeIdempotencyKey({
        ownerUid: caller.uid,
        taskType: aiTaskType,
        answerVersionId: String(answerVersionId || 'v1'),
        inputHash,
        previousVersionHash: prevHash,
        rubricHash,
        promptVersion: PROMPT_VERSION,
        taskBindingVersion: stage1Resolved.binding.updatedAt,
        modelProfileId: stage1Resolved.profile.id,
        actualModelId: stage1Resolved.profile.modelId,
        stage2ModelProfileId: stage2Resolved.profile.id,
        stage2ActualModelId: stage2Resolved.profile.modelId,
        criticalParametersHash: `${evaluationMode || 'deep-two-stage'}:${stage1Resolved.binding.allowTextFallbackForVision ?? true}`,
        imageHash: imageHashes.join(',') || 'no-image',
      });

      const cached = store.getIdempotentResponse(caller.uid, compositeKey);
      if (cached) {
        const cachedPayload = cached.body as {
          data: { evaluation: SubjectiveEvaluationResult; evaluationRun: EvaluationRun };
        };
        res.status(cached.status).json({
          ...cachedPayload,
          data: {
            ...cachedPayload.data,
            evaluation: {
              ...cachedPayload.data.evaluation,
              cacheStatus: 'hit',
            },
          },
        });
        return;
      }

      const stage1Adapter = createModelProvider({
        provider: stage1Resolved.connection.providerType,
        apiKey: stage1Resolved.plainApiKey,
        modelName: stage1Resolved.profile.modelId,
        baseUrl: stage1Resolved.connection.baseUrl,
        verifiedCapabilities: stage1Resolved.profile.capabilities,
        capabilitySource: stage1Resolved.profile.capabilitySource.vision,
        dnsLookupFn: options.dnsLookupFn,
      });

      // Smart Stage 2 trigger: only run independent Stage 2 call if Stage 2 is bound to a different model/provider OR explicitly requested
      const isStage2DistinctModel =
        stage2Resolved.profile.id !== stage1Resolved.profile.id ||
        stage2Resolved.connection.providerType !== stage1Resolved.connection.providerType;

      const stage2Adapter = isStage2DistinctModel
        ? createModelProvider({
            provider: stage2Resolved.connection.providerType,
            apiKey: stage2Resolved.plainApiKey,
            modelName: stage2Resolved.profile.modelId,
            baseUrl: stage2Resolved.connection.baseUrl,
            verifiedCapabilities: stage2Resolved.profile.capabilities,
            dnsLookupFn: options.dnsLookupFn,
          })
        : undefined;

      const abortController = new AbortController();
      req.on('close', () => {
        if (!res.writableEnded) abortController.abort();
      });

      const evaluation = await runTwoStageSubjectiveEvaluation(
        stage1Adapter,
        {
          taskType: taskType || 'translation',
          taskId: String(taskId || 'unit-subjective'),
          answerVersionId: String(answerVersionId || `ver-${Date.now()}`),
          previousAnswerVersionId: previousAnswerVersionId || null,
          previousVersionLabel,
          previousUserAnswer,
          previousEvaluation: previousEvaluation as SubjectiveEvaluationResult | undefined,
          evaluationMode: evaluationMode || 'deep-two-stage',
          usedHints: Boolean(usedHints),
          questionPrompt: String(questionPrompt || ''),
          userAnswer,
          maxScore: typeof maxScore === 'number' ? maxScore : undefined,
          rubric: rubric as ItemRubric | undefined,
          requiredFacts: Array.isArray(requiredFacts) ? requiredFacts.map(String) : undefined,
          hasVisualMaterial: Boolean(hasVisualMaterial || taskType === 'visual-writing'),
          images: loadedImages.length > 0 ? loadedImages : undefined,
          imageAssetsUsed,
          allowTextFallbackForVision:
            stage1Resolved.binding.allowTextFallbackForVision ?? true,
          referenceText: typeof referenceText === 'string' ? referenceText : undefined,
          signal: abortController.signal,
        },
        stage2Adapter
      );

      const runId = `run-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      evaluation.runId = runId;

      const evaluationRun: EvaluationRun = {
        runId,
        userId: caller.uid,
        taskType: aiTaskType,
        answerVersionId: evaluation.answerVersionId,
        previousAnswerVersionId: evaluation.previousAnswerVersionId,
        inputHash,
        rubricHash,
        promptVersion: PROMPT_VERSION,
        taskBindingVersion: stage1Resolved.binding.updatedAt,
        modelProfileId: stage1Resolved.profile.id,
        connectionId: stage1Resolved.connection.id,
        provider: stage1Resolved.connection.providerType,
        actualModelId: stage1Resolved.profile.modelId,
        stage2ModelProfileId: isStage2DistinctModel ? stage2Resolved.profile.id : null,
        stage2Provider: isStage2DistinctModel ? stage2Resolved.connection.providerType : null,
        stage2ActualModelId: isStage2DistinctModel ? stage2Resolved.profile.modelId : null,
        status:
          evaluation.reviewerDecision === 'provisional-stage2-failed'
            ? 'provisional-stage2-failed'
            : 'completed',
        startedAt: startedAtIso,
        completedAt: new Date().toISOString(),
        latencyMs: Date.now() - startMs,
        retryCount: evaluation.retryCount ?? 0,
        cacheStatus: 'miss',
        usage: evaluation.usage || {
          promptTokens: null,
          completionTokens: null,
          cachedTokens: null,
          totalTokens: null,
          source: 'unknown',
        },
        estimatedCostUsd: 0.002,
        finishReason: 'STOP',
        providerRequestId: runId,
        usedVision: Boolean(evaluation.usedVision),
        visionDegradedToText: Boolean(evaluation.visionDegradedToText),
      };

      store.saveEvaluationRun(evaluationRun);

      const bodyPayload = {
        ok: true,
        data: {
          evaluation,
          evaluationRun,
        },
        evaluation,
        evaluationRun,
      };

      store.setIdempotentResponse(caller.uid, compositeKey, 200, bodyPayload);

      console.info(
        '[AI Subjective Evaluation]',
        JSON.stringify(
          createRedactedLogEntry({
            requestId: runId,
            runId,
            uid: caller.uid,
            provider: stage1Resolved.connection.providerType,
            model: stage1Resolved.profile.modelId,
            taskType: aiTaskType,
            status: 'success',
            latencyMs: evaluationRun.latencyMs,
            tokenCount: evaluationRun.usage.totalTokens ?? undefined,
            retryCount: evaluationRun.retryCount,
          })
        )
      );

      res.json(bodyPayload);
    } catch (err) {
      const norm = normalizeToAIError(err);
      res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
    }
  });

  // ============================================================================
  // 6. Objective Question Analysis (With Data Quality Dispute Detection)
  // ============================================================================
  router.post('/objective-analyses', async (req: Request, res: Response) => {
    const startedAtIso = new Date().toISOString();
    const startMs = Date.now();
    try {
      const caller = await resolveCallerUid(req);
      if (!checkRateLimit(caller.uid, res)) return;

      const {
        provider: requestedProvider,
        modelProfileId: requestedProfileId,
        year,
        questionNumber,
        passageText,
        questionPrompt,
        options: itemOptions,
        correctAnswer,
        userSelectedAnswer,
        userMarkedErrorReasons,
      } = req.body || {};

      const resolved = store.resolveTaskModelBinding({
        ownerUid: caller.uid,
        taskType: 'objective_explanation',
        requestedProfileId,
        requestedProvider:
          requestedProvider && VALID_PROVIDERS.includes(requestedProvider)
            ? requestedProvider
            : undefined,
      });

      if (!resolved) {
        throw new SecurityError(
          'PROVIDER_CREDENTIAL_MISSING',
          '尚未配置用于「客观题解析」的 AI 模型，请前往设置页添加或选择默认模型。',
          400
        );
      }

      const adapter = createModelProvider({
        provider: resolved.connection.providerType,
        apiKey: resolved.plainApiKey,
        modelName: resolved.profile.modelId,
        baseUrl: resolved.connection.baseUrl,
        verifiedCapabilities: resolved.profile.capabilities,
        dnsLookupFn: options.dnsLookupFn,
      });

      const normalizedOptions = Array.isArray(itemOptions)
        ? itemOptions
        : itemOptions && typeof itemOptions === 'object'
        ? Object.entries(itemOptions).map(([key, text]) => ({ key: key as any, text: String(text) }))
        : [];

      const syntheticItemForAudit: ExamItem = {
        id: `q-${questionNumber}`,
        questionNumber: Number(questionNumber) || 1,
        answerMode: 'single-choice',
        prompt: String(questionPrompt || ''),
        options: normalizedOptions,
        score: 2,
        correctAnswer: String(correctAnswer || 'A'),
        answerSource: 'source-provided',
        sourceLocator: { sourceFile: `data/exams/raw/papers/${year || 2024}.md`, sourceFormat: 'md' },
      };

      const dataQuality: DataQualityConflictInfo = auditExamItemDataQuality(
        Number(year) || 2024,
        syntheticItemForAudit,
        String(passageText || ''),
        `data/exams/raw/papers/${year || 2024}.md`,
        `data/exams/raw/answers/${year || 2024}.md`
      );

      const analysis = await runObjectiveItemAnalysis(adapter, {
        questionNumber: Number(questionNumber) || 1,
        passageText: String(passageText || ''),
        questionPrompt: String(questionPrompt || ''),
        options: normalizedOptions,
        correctAnswer: String(correctAnswer || 'A'),
        userSelectedAnswer: String(userSelectedAnswer || ''),
        userMarkedErrorReasons: Array.isArray(userMarkedErrorReasons)
          ? userMarkedErrorReasons.map(String)
          : undefined,
        dataQuality,
      });

      const runId = `run-obj-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      analysis.runId = runId;

      store.saveEvaluationRun({
        runId,
        userId: caller.uid,
        taskType: 'objective_explanation',
        questionNumber: analysis.questionNumber,
        inputHash: `${analysis.questionNumber}:${userSelectedAnswer || ''}`,
        rubricHash: 'obj-v2',
        promptVersion: 'yanjuan-obj-v2.0',
        taskBindingVersion: resolved.binding.updatedAt,
        modelProfileId: resolved.profile.id,
        connectionId: resolved.connection.id,
        provider: resolved.connection.providerType,
        actualModelId: resolved.profile.modelId,
        status: 'completed',
        startedAt: startedAtIso,
        completedAt: new Date().toISOString(),
        latencyMs: Date.now() - startMs,
        retryCount: 0,
        cacheStatus: 'miss',
        usage: {
          promptTokens: null,
          completionTokens: null,
          cachedTokens: null,
          totalTokens: null,
          source: 'unknown',
        },
        estimatedCostUsd: 0.0008,
        finishReason: 'STOP',
        providerRequestId: runId,
        usedVision: false,
        visionDegradedToText: false,
      });

      res.json({
        ok: true,
        data: { analysis, dataQuality },
        analysis,
        dataQuality,
      });
    } catch (err) {
      const norm = normalizeToAIError(err);
      res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
    }
  });

  // ============================================================================
  // 7. Multi-Turn Contextual Follow-Up Chat
  // ============================================================================
  router.post('/follow-up-analyses', async (req: Request, res: Response) => {
    try {
      const caller = await resolveCallerUid(req);
      if (!checkRateLimit(caller.uid, res)) return;

      const {
        provider: requestedProvider,
        modelProfileId: requestedProfileId,
        year,
        attemptId,
        questionNumber,
        questionContext,
        userQuestion,
        existingAnalysisSummary,
        passageText,
        questionPrompt,
        options: itemOptions,
        correctAnswer,
        userAnswer,
        latestEvaluation,
        history,
        isSubmitted,
      } = req.body || {};

      if (!userQuestion || typeof userQuestion !== 'string' || !userQuestion.trim()) {
        throw new SecurityError('STRUCTURED_OUTPUT_INVALID', '追问内容不能为空', 400);
      }

      const resolved = store.resolveTaskModelBinding({
        ownerUid: caller.uid,
        taskType: 'followup_chat',
        requestedProfileId,
        requestedProvider:
          requestedProvider && VALID_PROVIDERS.includes(requestedProvider)
            ? requestedProvider
            : undefined,
      });

      if (!resolved) {
        throw new SecurityError(
          'PROVIDER_CREDENTIAL_MISSING',
          '尚未配置用于「继续追问」的 AI 模型，请前往设置页选择默认模型。',
          400
        );
      }

      const adapter = createModelProvider({
        provider: resolved.connection.providerType,
        apiKey: resolved.plainApiKey,
        modelName: resolved.profile.modelId,
        baseUrl: resolved.connection.baseUrl,
        verifiedCapabilities: resolved.profile.capabilities,
        dnsLookupFn: options.dnsLookupFn,
      });

      const isSubmittedAuthoritative =
        Boolean(isSubmitted) ||
        store.isQuestionSubmittedAuthoritative({
          ownerUid: caller.uid,
          attemptId: typeof attemptId === 'string' ? attemptId : undefined,
          year: typeof year === 'number' ? year : undefined,
          questionNumber: Number(questionNumber) || 1,
        });

      const followUpRes = await runContextualFollowUpAnalysis(adapter, {
        questionNumber: Number(questionNumber) || 1,
        questionContext: String(questionContext || '真题精读与写作单元'),
        userQuestion: userQuestion.trim(),
        existingAnalysisSummary:
          typeof existingAnalysisSummary === 'string' ? existingAnalysisSummary : undefined,
        item: {
          questionNumber: Number(questionNumber) || 1,
          prompt: typeof questionPrompt === 'string' ? questionPrompt : undefined,
          options: Array.isArray(itemOptions) ? itemOptions : undefined,
          correctAnswer: typeof correctAnswer === 'string' ? correctAnswer : null,
        },
        unit:
          typeof passageText === 'string' && passageText
            ? {
                materials: [
                  {
                    id: 'mat-1',
                    materialType: 'passage',
                    text: passageText,
                    relatedItemIds: [],
                  },
                ],
              }
            : undefined,
        userAnswer: typeof userAnswer === 'string' ? userAnswer : undefined,
        latestEvaluation: latestEvaluation as SubjectiveEvaluationResult | undefined,
        history: Array.isArray(history) ? (history as FollowUpTurn[]) : undefined,
        isSubmittedAuthoritative,
      });

      res.json({
        ok: true,
        data: {
          answer: followUpRes.answer,
          modelProvider: followUpRes.modelProvider,
          modelName: followUpRes.modelName,
          leakedFieldsRemoved: followUpRes.leakedFieldsRemoved,
        },
        answer: followUpRes.answer,
      });
    } catch (err) {
      const norm = normalizeToAIError(err);
      res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
    }
  });

  // ============================================================================
  // 8. Guided Writing / Translation Scaffold
  // ============================================================================
  router.post(['/writing-scaffolds', '/ai/writing-scaffolds'], async (req: Request, res: Response) => {
    try {
      const caller = await resolveCallerUid(req);
      if (!checkRateLimit(caller.uid, res)) return;

      const {
        provider: requestedProvider,
        modelProfileId: requestedProfileId,
        unitId,
        questionNumber,
        helpLevel,
        questionPrompt,
        requiredFacts,
      } = req.body || {};

      const resolved = store.resolveTaskModelBinding({
        ownerUid: caller.uid,
        taskType: 'writing_scaffold',
        requestedProfileId,
        requestedProvider:
          requestedProvider && VALID_PROVIDERS.includes(requestedProvider)
            ? requestedProvider
            : undefined,
      });

      if (!resolved) {
        throw new SecurityError(
          'PROVIDER_CREDENTIAL_MISSING',
          '尚未配置用于「写作结构支架」的 AI 模型，请前往设置页配置默认模型。',
          400
        );
      }

      const adapter = createModelProvider({
        provider: resolved.connection.providerType,
        apiKey: resolved.plainApiKey,
        modelName: resolved.profile.modelId,
        baseUrl: resolved.connection.baseUrl,
        verifiedCapabilities: resolved.profile.capabilities,
        dnsLookupFn: options.dnsLookupFn,
      });

      const scaffold = await runWritingScaffoldGeneration(adapter, {
        unitId: String(unitId || 'unit-writing'),
        questionNumber: Number(questionNumber) || 52,
        helpLevel: helpLevel === 2 || helpLevel === 3 ? helpLevel : 1,
        questionPrompt: String(questionPrompt || ''),
        requiredFacts: Array.isArray(requiredFacts) ? requiredFacts.map(String) : undefined,
      });

      res.json({
        ok: true,
        data: { scaffold },
        scaffold,
      });
    } catch (err) {
      const norm = normalizeToAIError(err);
      res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
    }
  });

  return { router, store };
}

export const createApiRouter = createApiV1Router;
