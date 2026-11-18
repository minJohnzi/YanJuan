import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { runPaperBuildPipeline } from '../pipeline/buildPipeline.ts';
import {
  stripExamAnswersForExamMode,
  auditExamItemDataQuality,
} from '../domain/quoteVerifier.ts';
import {
  resolveCanonicalPaperId,
  resolveLegacyYearFromPaperId,
} from '../domain/subjects.ts';
import type {
  AITaskType,
  DataQualityConflictInfo,
  EvaluationRun,
  Exam,
  ExamItem,
  FollowUpTurn,
  ItemRubric,
  MistakeDeterministicStats,
  MistakeItemMinimalPayload,
  MistakeSummaryScope,
  ModelCapabilities,
  ProviderConnection,
  ProviderType,
  SubjectId,
  SubjectiveEvaluationResult,
  TaskBindingConfig,
} from '../shared/types.ts';
import {
  MISTAKE_SUMMARY_PROMPT_VERSION,
  PROMPT_VERSION,
  runContextualFollowUpAnalysis,
  runMistakeSummaryAnalysis,
  runObjectiveItemAnalysis,
  runTwoStageSubjectiveEvaluation,
  runWritingScaffoldGeneration,
} from './aiEvaluators.ts';
import {
  resolveWorkspaceCaller,
} from './middleware/workspaceContext.ts';
import {
  type MultimodalImageInput,
  createModelProvider,
} from './modelProviders.ts';
import {
  PersistentAIStore,
  SERVER_GEMINI_CONNECTION_ID,
  computeCompositeIdempotencyKey,
} from './persistentStore.ts';
import { createSystemRouter } from './routes/systemRoutes.ts';
import {
  SecurityError,
  assertSafePathSegment,
  createRedactedLogEntry,
  isUserInOwnerUids,
  loadVerifiedExamImageAsset,
  normalizeProviderBaseUrl,
  normalizeToAIError,
  validateSafeCustomBaseUrl,
  verifyServerAiAccessPin,
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
  router.use('/system', createSystemRouter());

  const rootDir = options.rootDir || process.cwd();
  const store = new PersistentAIStore(options.storeFilePath);
  const maxPerMinute = options.rateLimitMaxPerMinute ?? 60;

  // Rate limit buckets: key -> timestamps[]
  const rateBuckets = new Map<string, number[]>();

  function enforceServerEnvPinIfNeeded(
    connection: Pick<ProviderConnection, 'id' | 'storageMode'> | undefined | null,
    req: Request
  ): void {
    if (!connection) return;
    if (connection.storageMode === 'server-env' || connection.id === SERVER_GEMINI_CONNECTION_ID) {
      const check = verifyServerAiAccessPin(req.header('X-Server-AI-Pin'));
      if (!check.allowed) {
        throw new SecurityError(
          'AUTH_REQUIRED',
          '调用服务端内置 Gemini 模型需提供有效的访问口令 (X-Server-AI-Pin)',
          401
        );
      }
    }
  }

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
   * Resolves caller workspace identity:
   * - If verifyIdTokenFn is explicitly provided (e.g. cloud auth tests), verifies Bearer token.
   * - Otherwise operates in Local-First workspace mode using `X-Workspace-Id` (default `'local-default'`).
   * - Rejects spoofed `userId` query/body mismatch with 403 FORBIDDEN_USER_MISMATCH.
   */
  async function resolveCallerUid(req: Request): Promise<{
    uid: string;
    email?: string;
    authenticated: boolean;
  }> {
    let resolvedUid = 'local-default';
    let resolvedEmail: string | undefined;
    let authenticated = false;

    if (options.verifyIdTokenFn) {
      resolvedUid = 'local-guest';
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice('Bearer '.length).trim();
        if (token && token !== 'local-guest-token') {
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
      } else {
        const requestedUserId =
          (req.query?.userId as string) || (req.body && (req.body.userId as string));
        if (requestedUserId) {
          throw new SecurityError('AUTH_REQUIRED', '访问用户专属配置需提供身份认证凭证', 401);
        }
      }
    } else {
      const ctx = await resolveWorkspaceCaller(req);
      resolvedUid = ctx.uid;
      authenticated = ctx.authenticated;
    }

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

  function loadGeneratedExam(
    yearOrPaperId: number | string,
    preferExamSheet: boolean = false
  ): Exam | null {
    const safeParam = assertSafePathSegment(String(yearOrPaperId), 'paperId');
    const paperId = resolveCanonicalPaperId(safeParam);
    const legacyYear = resolveLegacyYearFromPaperId(safeParam);

    const candidates = [
      ...(preferExamSheet
        ? [path.join(rootDir, 'data', 'exams', 'generated', 'papers', `${paperId}.exam.json`)]
        : []),
      path.join(rootDir, 'data', 'exams', 'generated', 'papers', `${legacyYear}.json`),
      path.join(rootDir, 'data', 'papers', String(legacyYear), 'v2.json'),
      path.join(rootDir, 'data', 'papers', String(legacyYear), 'v1.json'),
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
    const alreadyAudited = exam.sections.every((s) =>
      s.units.every((u) => u.items.every((item) => Boolean(item.dataQuality)))
    );
    if (alreadyAudited) {
      return exam;
    }

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
      const caller = await resolveCallerUid(req);
      const safeYearOrId = assertSafePathSegment(req.params.year, 'year');
      const mode = String(req.query.mode || 'study');
      const attemptId =
        typeof req.query.attemptId === 'string' ? req.query.attemptId.trim() : undefined;

      const isExamMode = mode === 'exam';
      const legacyYear = resolveLegacyYearFromPaperId(safeYearOrId);
      const isSubmittedAuthoritative = store.isQuestionSubmittedAuthoritative({
        ownerUid: caller.uid,
        attemptId,
        year: legacyYear || undefined,
        questionNumber: 1,
      });

      const shouldStripAnswers = isExamMode && !isSubmittedAuthoritative;
      const exam = loadGeneratedExam(safeYearOrId, shouldStripAnswers);
      if (!exam) {
        res
          .status(404)
          .json({ error: { code: 'EXAM_NOT_FOUND', message: `未找到 ${safeYearOrId} 试卷` } });
        return;
      }

      const auditedExam = attachDataQualityAuditToExam(exam);
      res.json({
        data: shouldStripAnswers ? stripExamAnswersForExamMode(auditedExam) : auditedExam,
      });
    } catch (err) {
      const norm = normalizeToAIError(err);
      res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
    }
  });

  router.get('/papers/:year/:version', (req: Request, res: Response) => {
    try {
      const rawYear = assertSafePathSegment(req.params.year, 'year');
      const version = assertSafePathSegment(req.params.version, 'version');
      const legacyYear = resolveLegacyYearFromPaperId(rawYear);
      const candidates = [
        path.join(rootDir, 'data', 'papers', String(legacyYear || rawYear), `${version}.json`),
        path.join(rootDir, 'data', 'exams', 'generated', 'papers', `${legacyYear || rawYear}.json`),
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
    } catch (err) {
      const norm = normalizeToAIError(err);
      res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
    }
  });

  router.get('/import-reports/:year/:version', (req: Request, res: Response) => {
    try {
      const rawYear = assertSafePathSegment(req.params.year, 'year');
      const version = assertSafePathSegment(req.params.version, 'version');
      const legacyYear = resolveLegacyYearFromPaperId(rawYear);
      const reportPath = path.join(
        rootDir,
        'data',
        'import-reports',
        String(legacyYear || rawYear),
        `${version}.json`
      );
      if (fs.existsSync(reportPath)) {
        res.json({ data: JSON.parse(fs.readFileSync(reportPath, 'utf8')) });
        return;
      }
      const exam = loadGeneratedExam(rawYear);
      if (exam?.validationReport) {
        res.json({ data: exam.validationReport });
        return;
      }
      res.status(404).json({ error: { code: 'REPORT_NOT_FOUND', message: '未找到校验报告' } });
    } catch (err) {
      const norm = normalizeToAIError(err);
      res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
    }
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

  router.post(
    ['/exams/:year/submit', '/exams/:year/submit-attempt', '/exams/:year/attempts/:attemptId/submit'],
    async (req: Request, res: Response) => {
      try {
        const caller = await resolveCallerUid(req);
        const safeYear = assertSafePathSegment(req.params.year, 'year');
        const year = resolveLegacyYearFromPaperId(safeYear);
        const paperId = resolveCanonicalPaperId(safeYear);
        const attemptId = String(req.params.attemptId || req.body?.attemptId || `attempt-${paperId}`);
        const submittedQuestions = Array.isArray(req.body?.submittedQuestions)
          ? req.body.submittedQuestions.map(Number)
          : undefined;
        const record = store.markAttemptSubmitted({
          ownerUid: caller.uid,
          attemptId,
          year,
          paperId,
          submittedQuestions,
          submittedAll: req.body?.submittedAll !== false,
        });
        res.json({ ok: true, data: record });
      } catch (err) {
        const norm = normalizeToAIError(err);
        res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
      }
    }
  );

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
                : 'encrypted-sqlite',
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
        const activeConn = connectionId
          ? store.getWorkspace(caller.uid).connections.find((c) => c.id === connectionId) || null
          : null;
        enforceServerEnvPinIfNeeded(
          activeConn ??
            (connectionId === SERVER_GEMINI_CONNECTION_ID
              ? { id: SERVER_GEMINI_CONNECTION_ID, storageMode: 'server-env' }
              : null),
          req
        );
        effectiveApiKey = cred.plainKey;
        if (!effectiveBaseUrl && cred.record?.baseUrl) {
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
        const activeConn = connectionId
          ? store.getWorkspace(caller.uid).connections.find((c) => c.id === connectionId) || null
          : null;
        enforceServerEnvPinIfNeeded(
          activeConn ??
            (connectionId === SERVER_GEMINI_CONNECTION_ID
              ? { id: SERVER_GEMINI_CONNECTION_ID, storageMode: 'server-env' }
              : null),
          req
        );
        effectiveApiKey = saved.plainKey;
        if (!effectiveBaseUrl && saved.record?.baseUrl) {
          effectiveBaseUrl = saved.record.baseUrl;
        }
        if (!effectiveModel && saved.record?.model) {
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
        materialText,
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

      enforceServerEnvPinIfNeeded(stage1Resolved.connection, req);

      const stage2Resolved =
        store.resolveTaskModelBinding({
          ownerUid: caller.uid,
          taskType: 'subjective_stage2',
          requestedProfileId: requestedStage2ProfileId,
        }) || stage1Resolved;

      enforceServerEnvPinIfNeeded(stage2Resolved.connection, req);

      // Load real verified exam image assets for visual writing
      const loadedImages: MultimodalImageInput[] = [];
      const imageAssetsUsed: string[] = [];
      const imageHashes: string[] = [];

      const candidateImagePaths: string[] = Array.isArray(imagePaths) ? [...imagePaths] : [];
      const inferredYear =
        typeof year === 'number'
          ? year
          : typeof year === 'string' && year.trim()
          ? resolveLegacyYearFromPaperId(year)
          : typeof answerVersionId === 'string' && /ver-(\d{4,6})/.test(answerVersionId)
          ? Number(answerVersionId.match(/ver-(\d{4,6})/)![1])
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
          materialText: typeof materialText === 'string' ? materialText : undefined,
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

      enforceServerEnvPinIfNeeded(resolved.connection, req);

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

      const resolvedObjYear =
        typeof year === 'number'
          ? year
          : typeof year === 'string' && year.trim()
          ? resolveLegacyYearFromPaperId(year) || 2024
          : 2024;

      const syntheticItemForAudit: ExamItem = {
        id: `q-${questionNumber}`,
        questionNumber: Number(questionNumber) || 1,
        answerMode: 'single-choice',
        prompt: String(questionPrompt || ''),
        options: normalizedOptions,
        score: 2,
        correctAnswer: String(correctAnswer || 'A'),
        answerSource: 'source-provided',
        sourceLocator: { sourceFile: `data/exams/raw/papers/${resolvedObjYear}.md`, sourceFormat: 'md' },
      };

      const dataQuality: DataQualityConflictInfo = auditExamItemDataQuality(
        resolvedObjYear,
        syntheticItemForAudit,
        String(passageText || ''),
        `data/exams/raw/papers/${resolvedObjYear}.md`,
        `data/exams/raw/answers/${resolvedObjYear}.md`
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
        mode,
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

      enforceServerEnvPinIfNeeded(resolved.connection, req);

      const adapter = createModelProvider({
        provider: resolved.connection.providerType,
        apiKey: resolved.plainApiKey,
        modelName: resolved.profile.modelId,
        baseUrl: resolved.connection.baseUrl,
        verifiedCapabilities: resolved.profile.capabilities,
        dnsLookupFn: options.dnsLookupFn,
      });

      const resolvedYear =
        typeof year === 'number'
          ? year
          : typeof year === 'string' && year.trim()
          ? resolveLegacyYearFromPaperId(year)
          : undefined;

      const authoritativeSubmitted = store.isQuestionSubmittedAuthoritative({
        ownerUid: caller.uid,
        attemptId: typeof attemptId === 'string' ? attemptId : undefined,
        year: resolvedYear,
        questionNumber: Number(questionNumber) || 1,
      });

      const isSubmittedAuthoritative =
        mode === 'exam'
          ? authoritativeSubmitted
          : authoritativeSubmitted || Boolean(isSubmitted);

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
          correctAnswer:
            isSubmittedAuthoritative && typeof correctAnswer === 'string'
              ? correctAnswer
              : null,
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

      enforceServerEnvPinIfNeeded(resolved.connection, req);

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

  // ============================================================================
  // 9. Overall Mistake Analysis & Knowledge Summary (By Paper / By Subject)
  // ============================================================================
  router.post('/mistake-summaries', async (req: Request, res: Response) => {
    const startMs = Date.now();
    const startedAtIso = new Date().toISOString();
    try {
      const caller = await resolveCallerUid(req);
      if (!checkRateLimit(caller.uid, res)) return;

      const {
        provider: requestedProvider,
        modelProfileId: requestedProfileId,
        subjectId,
        scope,
        scopeTitle,
        moduleLabel,
        batchIndex,
        totalBatches,
        deterministicStats,
        items,
      } = req.body || {};

      if (subjectId !== 'english-i' && subjectId !== 'politics') {
        throw new SecurityError(
          'STRUCTURED_OUTPUT_INVALID',
          'subjectId 必须为 english-i 或 politics（严格学科隔离）',
          400
        );
      }

      if (!Array.isArray(items) || items.length === 0) {
        throw new SecurityError(
          'STRUCTURED_OUTPUT_INVALID',
          '错题列表 items 不能为空',
          400
        );
      }

      if (items.length > 30) {
        throw new SecurityError(
          'STRUCTURED_OUTPUT_INVALID',
          `单次错题总结请求上限为 30 题（当前传入 ${items.length} 题），请按模块拆批后提交`,
          400
        );
      }

      const typedItems = items as MistakeItemMinimalPayload[];
      const hasCrossSubjectLeak = typedItems.some(
        (it) => it.subjectId && it.subjectId !== subjectId
      );
      if (hasCrossSubjectLeak) {
        throw new SecurityError(
          'STRUCTURED_OUTPUT_INVALID',
          '检测到跨学科混排错题项，请保持政治与英语一严格隔离',
          400
        );
      }

      const resolved = store.resolveTaskModelBinding({
        ownerUid: caller.uid,
        taskType: 'mistake_summary',
        requestedProfileId,
        requestedProvider:
          requestedProvider && VALID_PROVIDERS.includes(requestedProvider)
            ? requestedProvider
            : undefined,
      });

      if (!resolved) {
        throw new SecurityError(
          'PROVIDER_CREDENTIAL_MISSING',
          '尚未配置用于「错题整体分析与知识点总结」的 AI 模型，请前往设置页配置默认模型。',
          400
        );
      }

      enforceServerEnvPinIfNeeded(resolved.connection, req);

      const adapter = createModelProvider({
        provider: resolved.connection.providerType,
        apiKey: resolved.plainApiKey,
        modelName: resolved.profile.modelId,
        baseUrl: resolved.connection.baseUrl,
        verifiedCapabilities: resolved.profile.capabilities,
        dnsLookupFn: options.dnsLookupFn,
      });

      const result = await runMistakeSummaryAnalysis(adapter, {
        subjectId: subjectId as SubjectId,
        scope: scope === 'by-paper' ? 'by-paper' : ('by-subject' as MistakeSummaryScope),
        scopeTitle: typeof scopeTitle === 'string' ? scopeTitle : undefined,
        moduleLabel: typeof moduleLabel === 'string' ? moduleLabel : undefined,
        batchIndex: typeof batchIndex === 'number' ? batchIndex : 1,
        totalBatches: typeof totalBatches === 'number' ? totalBatches : 1,
        deterministicStats: deterministicStats as MistakeDeterministicStats | undefined,
        items: typedItems,
        temperature: resolved.binding.temperature,
        maxOutputTokens: Math.max(resolved.binding.maxOutputTokens || 8192, 4096),
        timeoutMs: Math.max(resolved.binding.timeoutMs || 90000, 60000),
        disableThinking: true,
      });

      const runId = `run-ms-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const inputHash = crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            subjectId,
            scope,
            items: typedItems.map((i) => `${i.paperId}:${i.questionNumber}:${i.userSelectedAnswer}`),
          })
        )
        .digest('hex')
        .slice(0, 16);

      store.saveEvaluationRun({
        runId,
        userId: caller.uid,
        taskType: 'mistake_summary',
        inputHash,
        rubricHash: `ms-${subjectId}`,
        promptVersion: MISTAKE_SUMMARY_PROMPT_VERSION,
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
        estimatedCostUsd: 0.002,
        finishReason: 'STOP',
        providerRequestId: runId,
        usedVision: false,
        visionDegradedToText: false,
      });

      createRedactedLogEntry({
        requestId: runId,
        runId,
        uid: caller.uid,
        provider: resolved.connection.providerType,
        model: resolved.profile.modelId,
        taskType: 'mistake_summary',
        status: 'success',
        latencyMs: Date.now() - startMs,
      });

      res.json({
        ok: true,
        data: {
          runId,
          markdown: result.markdown,
          modelProvider: result.modelProvider,
          modelName: result.modelName,
          promptVersion: result.promptVersion,
          latencyMs: result.latencyMs,
        },
      });
    } catch (err) {
      const norm = normalizeToAIError(err);
      res.status(norm.status).json({ error: { code: norm.code, message: norm.userMessage } });
    }
  });

  return { router, store };
}

export const createApiRouter = createApiV1Router;
