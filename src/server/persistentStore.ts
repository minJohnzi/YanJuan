import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AITaskType,
  EvaluationRun,
  ModelProfile,
  ProviderConnection,
  ProviderType,
  TaskBindingConfig,
  UserAIWorkspaceConfig,
} from '../shared/types.ts';
import {
  type EncryptedCredentialRecord,
  SecurityError,
  computeConfigurationHash,
  decryptProviderApiKey,
  encryptProviderApiKey,
  normalizeProviderBaseUrl,
} from './securityAndCrypto.ts';

export const ALL_AI_TASK_TYPES: AITaskType[] = [
  'objective_explanation',
  'subjective_stage1',
  'subjective_stage2',
  'visual_writing',
  'followup_chat',
  'writing_scaffold',
];

export function createDefaultTaskBindings(
  defaultProfileId: string | null = null
): Record<AITaskType, TaskBindingConfig> {
  const now = new Date().toISOString();
  return {
    objective_explanation: {
      taskType: 'objective_explanation',
      primaryModelProfileId: defaultProfileId,
      fallbackModelProfileId: null,
      timeoutMs: 25000,
      retryBudget: 1,
      temperature: 0.2,
      maxOutputTokens: 2048,
      structuredOutputStrategy: 'json_object',
      promptVersion: 'yanjuan-obj-v2.0',
      enabled: true,
      updatedAt: now,
    },
    subjective_stage1: {
      taskType: 'subjective_stage1',
      primaryModelProfileId: defaultProfileId,
      fallbackModelProfileId: null,
      timeoutMs: 35000,
      retryBudget: 2,
      temperature: 0.2,
      maxOutputTokens: 4096,
      structuredOutputStrategy: 'json_schema',
      promptVersion: 'yanjuan-eval-v2.0',
      enabled: true,
      updatedAt: now,
    },
    subjective_stage2: {
      taskType: 'subjective_stage2',
      primaryModelProfileId: defaultProfileId,
      fallbackModelProfileId: null,
      timeoutMs: 30000,
      retryBudget: 1,
      temperature: 0.1,
      maxOutputTokens: 3072,
      structuredOutputStrategy: 'json_schema',
      promptVersion: 'yanjuan-review-v2.0',
      enabled: true,
      updatedAt: now,
    },
    visual_writing: {
      taskType: 'visual_writing',
      primaryModelProfileId: defaultProfileId,
      fallbackModelProfileId: null,
      timeoutMs: 40000,
      retryBudget: 2,
      temperature: 0.2,
      maxOutputTokens: 4096,
      structuredOutputStrategy: 'json_schema',
      promptVersion: 'yanjuan-vision-v2.0',
      allowTextFallbackForVision: false,
      enabled: true,
      updatedAt: now,
    },
    followup_chat: {
      taskType: 'followup_chat',
      primaryModelProfileId: defaultProfileId,
      fallbackModelProfileId: null,
      timeoutMs: 25000,
      retryBudget: 1,
      temperature: 0.3,
      maxOutputTokens: 2048,
      structuredOutputStrategy: 'prompt_only',
      promptVersion: 'yanjuan-followup-v2.0',
      enabled: true,
      updatedAt: now,
    },
    writing_scaffold: {
      taskType: 'writing_scaffold',
      primaryModelProfileId: defaultProfileId,
      fallbackModelProfileId: null,
      timeoutMs: 25000,
      retryBudget: 1,
      temperature: 0.3,
      maxOutputTokens: 2048,
      structuredOutputStrategy: 'json_object',
      promptVersion: 'yanjuan-scaffold-v2.0',
      enabled: true,
      updatedAt: now,
    },
  };
}

export interface IdempotencyIdentityInput {
  ownerUid: string;
  taskType: AITaskType;
  answerVersionId: string;
  inputHash: string;
  previousVersionHash?: string;
  rubricHash: string;
  promptVersion: string;
  taskBindingVersion: string;
  modelProfileId: string;
  actualModelId: string;
  stage2ModelProfileId?: string;
  stage2ActualModelId?: string;
  criticalParametersHash: string;
  imageHash?: string;
}

export function computeCompositeIdempotencyKey(input: IdempotencyIdentityInput): string {
  const canonical = JSON.stringify({
    ownerUid: input.ownerUid,
    taskType: input.taskType,
    answerVersionId: input.answerVersionId,
    inputHash: input.inputHash,
    previousVersionHash: input.previousVersionHash || 'none',
    rubricHash: input.rubricHash,
    promptVersion: input.promptVersion,
    taskBindingVersion: input.taskBindingVersion,
    modelProfileId: input.modelProfileId,
    actualModelId: input.actualModelId,
    stage2ModelProfileId: input.stage2ModelProfileId || input.modelProfileId,
    stage2ActualModelId: input.stage2ActualModelId || input.actualModelId,
    criticalParametersHash: input.criticalParametersHash,
    imageHash: input.imageHash || 'no-image',
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export interface StoredIdempotencyEntry {
  compositeKey: string;
  ownerUid: string;
  createdAt: number;
  expiresAt: number;
  status: number;
  body: unknown;
}

export interface AttemptSubmissionRecord {
  ownerUid: string;
  attemptId: string;
  year: number;
  submittedQuestions: number[];
  submittedAll: boolean;
  submittedAt: string;
}

interface DiskStoreSchema {
  schemaVersion: number;
  updatedAt: string;
  credentials: Record<string, EncryptedCredentialRecord>;
  workspaces: Record<string, UserAIWorkspaceConfig>;
  evaluationRuns: Record<string, EvaluationRun>;
  submissions: Record<string, AttemptSubmissionRecord>;
  idempotencyRecords: Record<string, StoredIdempotencyEntry>;
}

/**
 * Persistent store for user AI connections, model profiles, task bindings, encrypted credentials,
 * evaluation runs, and authoritative exam submission states.
 * - Persistent records (`persistent-encrypted`) are atomically written to disk so they survive server restarts.
 * - Session-only records (`session-only`) are kept strictly in process memory and never written to disk.
 */
export class PersistentAIStore {
  private readonly storeFilePath: string;
  private diskState: DiskStoreSchema;
  // Session-only in-memory credentials and connections (wiped on process restart)
  private readonly sessionCredentials = new Map<string, EncryptedCredentialRecord>();
  private readonly sessionWorkspaces = new Map<string, UserAIWorkspaceConfig>();

  constructor(storeFilePath?: string) {
    this.storeFilePath =
      storeFilePath || path.join(process.cwd(), 'data', 'runtime', 'ai-workspace-store.json');
    this.diskState = this.loadFromDisk();
  }

  private loadFromDisk(): DiskStoreSchema {
    try {
      if (fs.existsSync(this.storeFilePath)) {
        const raw = fs.readFileSync(this.storeFilePath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<DiskStoreSchema>;
        return {
          schemaVersion: 2,
          updatedAt: parsed.updatedAt || new Date().toISOString(),
          credentials: parsed.credentials || {},
          workspaces: parsed.workspaces || {},
          evaluationRuns: parsed.evaluationRuns || {},
          submissions: parsed.submissions || {},
          idempotencyRecords: parsed.idempotencyRecords || {},
        };
      }
    } catch {
      // Fallback to fresh state if corrupted
    }
    return {
      schemaVersion: 2,
      updatedAt: new Date().toISOString(),
      credentials: {},
      workspaces: {},
      evaluationRuns: {},
      submissions: {},
      idempotencyRecords: {},
    };
  }

  private flushToDisk(): void {
    try {
      this.diskState.updatedAt = new Date().toISOString();
      const dir = path.dirname(this.storeFilePath);
      fs.mkdirSync(dir, { recursive: true });
      const tmpPath = `${this.storeFilePath}.tmp.${process.pid}`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.diskState, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.storeFilePath);
    } catch {
      // Ignore write failures in read-only test sandboxes
    }
  }

  public getWorkspace(ownerUid: string): UserAIWorkspaceConfig {
    let persistentWs = this.diskState.workspaces[ownerUid];
    if (!persistentWs) {
      persistentWs = {
        ownerUid,
        defaultModelProfileId: null,
        connections: [],
        modelProfiles: [],
        taskBindings: createDefaultTaskBindings(null),
        dailyBudgetUsd: 5.0,
        dailySpentUsd: 0,
        maxConcurrentJobs: 3,
        updatedAt: new Date().toISOString(),
      };
      this.diskState.workspaces[ownerUid] = persistentWs;
    }

    const sessionWs = this.sessionWorkspaces.get(ownerUid);
    if (!sessionWs) {
      return persistentWs;
    }

    // Merge session-only connections and profiles into the effective view
    const connMap = new Map<string, ProviderConnection>();
    for (const c of persistentWs.connections) connMap.set(c.id, c);
    for (const c of sessionWs.connections) connMap.set(c.id, c);

    const profMap = new Map<string, ModelProfile>();
    for (const p of persistentWs.modelProfiles) profMap.set(p.id, p);
    for (const p of sessionWs.modelProfiles) profMap.set(p.id, p);

    return {
      ...persistentWs,
      defaultModelProfileId:
        sessionWs.defaultModelProfileId || persistentWs.defaultModelProfileId,
      connections: Array.from(connMap.values()),
      modelProfiles: Array.from(profMap.values()),
      taskBindings: {
        ...persistentWs.taskBindings,
        ...sessionWs.taskBindings,
      },
    };
  }

  public upsertConnectionAndProfile(params: {
    ownerUid: string;
    connectionId?: string;
    providerType: ProviderType;
    displayName?: string;
    baseUrl?: string;
    protocolMode?: 'chat-completions' | 'gemini-native';
    apiKey?: string;
    storageMode: 'persistent-encrypted' | 'session-only';
    modelId: string;
    modelDisplayName?: string;
    modelSource: 'provider-list' | 'manual';
    verifiedCapabilities?: Partial<ModelProfile['capabilities']>;
    capabilitySource?: Partial<ModelProfile['capabilitySource']>;
    setAsDefault?: boolean;
    extraHeaders?: Record<string, string>;
    modelsListPath?: string;
  }): {
    connection: ProviderConnection;
    profile: ModelProfile;
    workspace: UserAIWorkspaceConfig;
  } {
    const nowIso = new Date().toISOString();
    const normalizedBase = normalizeProviderBaseUrl(params.providerType, params.baseUrl);
    const protocolMode =
      params.protocolMode ||
      (params.providerType === 'gemini' ? 'gemini-native' : 'chat-completions');
    const connId =
      params.connectionId || `conn-${params.providerType}-${crypto.randomBytes(4).toString('hex')}`;
    const credKey = `${params.ownerUid}:${connId}`;
    const legacyCredKey = `${params.ownerUid}:${params.providerType}`;

    let encRecord: EncryptedCredentialRecord | undefined;
    if (params.apiKey && params.apiKey.trim()) {
      encRecord = encryptProviderApiKey(
        params.ownerUid,
        params.providerType,
        params.apiKey.trim(),
        {
          connectionId: connId,
          model: params.modelId.trim(),
          baseUrl: normalizedBase,
          protocolMode,
        }
      );
      if (params.storageMode === 'persistent-encrypted') {
        this.diskState.credentials[credKey] = encRecord;
        this.diskState.credentials[legacyCredKey] = encRecord;
      } else {
        this.sessionCredentials.set(credKey, encRecord);
        this.sessionCredentials.set(legacyCredKey, encRecord);
      }
    } else {
      encRecord =
        this.diskState.credentials[credKey] ||
        this.sessionCredentials.get(credKey) ||
        this.diskState.credentials[legacyCredKey] ||
        this.sessionCredentials.get(legacyCredKey);
      if (!encRecord) {
        throw new SecurityError(
          'PROVIDER_CREDENTIAL_MISSING',
          '新建连接必须提供有效的 API Key',
          400
        );
      }
      // Update model and baseUrl on existing credential record
      const updatedHash = computeConfigurationHash({
        connectionId: connId,
        providerType: params.providerType,
        baseUrl: normalizedBase,
        modelId: params.modelId.trim(),
        protocolMode,
        credentialFingerprint: encRecord.maskedKey,
      });
      if (encRecord.configurationHash !== updatedHash) {
        encRecord.lastTestStatus = 'invalidated';
        encRecord.lastTestedAt = null;
      }
      encRecord.model = params.modelId.trim();
      encRecord.baseUrl = normalizedBase;
      encRecord.protocolMode = protocolMode;
      encRecord.configurationHash = updatedHash;
      encRecord.updatedAt = nowIso;
    }

    const configHash = encRecord.configurationHash!;
    const connection: ProviderConnection = {
      id: connId,
      ownerUid: params.ownerUid,
      providerType: params.providerType,
      displayName:
        params.displayName?.trim() ||
        `${
          params.providerType === 'gemini'
            ? 'Google Gemini'
            : params.providerType === 'deepseek'
            ? 'DeepSeek'
            : 'OpenAI Compatible'
        } (${params.modelId.trim()})`,
      baseUrl: normalizedBase,
      protocolMode,
      authenticationType: params.providerType === 'gemini' ? 'x-goog-api-key' : 'bearer',
      credentialReference: credKey,
      maskedKey: encRecord.maskedKey,
      storageMode: params.storageMode,
      enabled: true,
      configurationHash: configHash,
      lastTestStatus: encRecord.lastTestStatus,
      lastTestedAt: encRecord.lastTestedAt,
      lastErrorCode: null,
      extraHeaders: params.extraHeaders,
      modelsListPath: params.modelsListPath,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const profileId = `prof-${connId}-${params.modelId.trim().replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const isManual = params.modelSource === 'manual';

    // Manual models NEVER automatically receive unverified capabilities!
    const defaultCaps = isManual
      ? {
          text: true,
          structuredOutput: false,
          jsonSchema: false,
          jsonObject: false,
          vision: false,
          streaming: false,
          reasoning: false,
          ...params.verifiedCapabilities,
        }
      : {
          text: true,
          structuredOutput: true,
          jsonSchema: params.providerType === 'gemini',
          jsonObject: true,
          vision: false,
          streaming: true,
          reasoning: params.providerType !== 'openai-compatible',
          ...params.verifiedCapabilities,
        };

    const defaultCapSource = isManual
      ? {
          text: 'manual' as const,
          structuredOutput: 'unknown' as const,
          vision: 'unknown' as const,
          streaming: 'unknown' as const,
          reasoning: 'unknown' as const,
          ...params.capabilitySource,
        }
      : {
          text: 'provider' as const,
          structuredOutput: 'provider' as const,
          vision: 'unknown' as const,
          streaming: 'provider' as const,
          reasoning: 'provider' as const,
          ...params.capabilitySource,
        };

    const profile: ModelProfile = {
      id: profileId,
      connectionId: connId,
      ownerUid: params.ownerUid,
      providerType: params.providerType,
      modelId: params.modelId.trim(),
      displayName: params.modelDisplayName || params.modelId.trim(),
      source: params.modelSource,
      capabilities: defaultCaps,
      capabilitySource: defaultCapSource,
      contextWindow: params.providerType === 'gemini' ? 1048576 : 65536,
      outputLimit: params.providerType === 'gemini' ? 65536 : 8192,
      structuredOutputStrategy: defaultCaps.jsonSchema
        ? 'json_schema'
        : defaultCaps.jsonObject
        ? 'json_object'
        : 'prompt_only',
      defaultParameters: {
        temperature: 0.2,
        maxOutputTokens: 4096,
        timeoutMs: 30000,
      },
      configurationHash: configHash,
      lastVerifiedAt: encRecord.lastTestedAt,
      enabled: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const targetWs =
      params.storageMode === 'persistent-encrypted'
        ? this.getOrCreatePersistentWorkspace(params.ownerUid)
        : this.getOrCreateSessionWorkspace(params.ownerUid);

    targetWs.connections = [
      ...targetWs.connections.filter((c) => c.id !== connId),
      connection,
    ];
    targetWs.modelProfiles = [
      ...targetWs.modelProfiles.filter((p) => p.id !== profileId),
      profile,
    ];

    if (params.setAsDefault || !targetWs.defaultModelProfileId) {
      targetWs.defaultModelProfileId = profile.id;
    }
    targetWs.updatedAt = nowIso;

    if (params.storageMode === 'persistent-encrypted') {
      this.flushToDisk();
    }

    return {
      connection,
      profile,
      workspace: this.getWorkspace(params.ownerUid),
    };
  }

  private getOrCreatePersistentWorkspace(ownerUid: string): UserAIWorkspaceConfig {
    if (!this.diskState.workspaces[ownerUid]) {
      this.diskState.workspaces[ownerUid] = {
        ownerUid,
        defaultModelProfileId: null,
        connections: [],
        modelProfiles: [],
        taskBindings: createDefaultTaskBindings(null),
        dailyBudgetUsd: 5.0,
        dailySpentUsd: 0,
        maxConcurrentJobs: 3,
        updatedAt: new Date().toISOString(),
      };
    }
    return this.diskState.workspaces[ownerUid];
  }

  private getOrCreateSessionWorkspace(ownerUid: string): UserAIWorkspaceConfig {
    let ws = this.sessionWorkspaces.get(ownerUid);
    if (!ws) {
      ws = {
        ownerUid,
        defaultModelProfileId: null,
        connections: [],
        modelProfiles: [],
        taskBindings: createDefaultTaskBindings(null),
        dailyBudgetUsd: 5.0,
        dailySpentUsd: 0,
        maxConcurrentJobs: 3,
        updatedAt: new Date().toISOString(),
      };
      this.sessionWorkspaces.set(ownerUid, ws);
    }
    return ws;
  }

  public setDefaultModelProfile(ownerUid: string, profileId: string): UserAIWorkspaceConfig {
    const ws = this.getWorkspace(ownerUid);
    const target = ws.modelProfiles.find((p) => p.id === profileId);
    if (!target) {
      throw new SecurityError('MODEL_NOT_FOUND', `未找到模型档案: ${profileId}`, 404);
    }
    const pWs = this.getOrCreatePersistentWorkspace(ownerUid);
    pWs.defaultModelProfileId = profileId;
    pWs.updatedAt = new Date().toISOString();
    const sWs = this.sessionWorkspaces.get(ownerUid);
    if (sWs) {
      sWs.defaultModelProfileId = profileId;
    }
    this.flushToDisk();
    return this.getWorkspace(ownerUid);
  }

  public updateTaskBindings(
    ownerUid: string,
    patch: Partial<Record<AITaskType, Partial<TaskBindingConfig>>>
  ): UserAIWorkspaceConfig {
    const ws = this.getWorkspace(ownerUid);
    const pWs = this.getOrCreatePersistentWorkspace(ownerUid);
    const nowIso = new Date().toISOString();

    for (const [taskKey, cfg] of Object.entries(patch)) {
      const taskType = taskKey as AITaskType;
      if (!ALL_AI_TASK_TYPES.includes(taskType) || !cfg) continue;

      // Enforce vision capability check when binding visual_writing primary model
      if (taskType === 'visual_writing' && cfg.primaryModelProfileId) {
        const prof = ws.modelProfiles.find((p) => p.id === cfg.primaryModelProfileId);
        const allowFallback =
          cfg.allowTextFallbackForVision ??
          ws.taskBindings.visual_writing?.allowTextFallbackForVision ??
          false;
        if (prof && !prof.capabilities.vision && !allowFallback) {
          throw new SecurityError(
            'VISION_NOT_SUPPORTED',
            `模型 ${prof.displayName} 尚未通过视觉能力验证，不能直接绑定为图画作文主模型（除非显式开启“文字事实降级模式”）`,
            422
          );
        }
      }

      const existing = pWs.taskBindings[taskType] || createDefaultTaskBindings(null)[taskType];
      pWs.taskBindings[taskType] = {
        ...existing,
        ...cfg,
        taskType,
        updatedAt: nowIso,
      };
    }

    pWs.updatedAt = nowIso;
    this.flushToDisk();
    return this.getWorkspace(ownerUid);
  }

  public recordTestResult(params: {
    ownerUid: string;
    connectionId?: string;
    providerType: ProviderType;
    modelId: string;
    configurationHash: string;
    ok: boolean;
    testedAt: string;
    verifiedCapabilities?: Partial<ModelProfile['capabilities']>;
    capabilitySources?: Partial<ModelProfile['capabilitySource']>;
    layers?: ModelProfile['lastTestLayers'];
  }): void {
    const ws = this.getOrCreatePersistentWorkspace(params.ownerUid);
    const sWs = this.sessionWorkspaces.get(params.ownerUid);

    for (const targetWs of [ws, sWs].filter(Boolean) as UserAIWorkspaceConfig[]) {
      for (const conn of targetWs.connections) {
        if (
          (params.connectionId && conn.id === params.connectionId) ||
          (!params.connectionId && conn.providerType === params.providerType)
        ) {
          conn.lastTestStatus = params.ok ? 'success' : 'failed';
          conn.lastTestedAt = params.testedAt;
          conn.configurationHash = params.configurationHash;
          conn.updatedAt = params.testedAt;
        }
      }
      for (const prof of targetWs.modelProfiles) {
        if (
          prof.modelId === params.modelId &&
          (!params.connectionId || prof.connectionId === params.connectionId)
        ) {
          if (params.verifiedCapabilities) {
            prof.capabilities = { ...prof.capabilities, ...params.verifiedCapabilities };
          }
          if (params.capabilitySources) {
            prof.capabilitySource = { ...prof.capabilitySource, ...params.capabilitySources };
          }
          if (params.layers) {
            prof.lastTestLayers = { ...prof.lastTestLayers, ...params.layers };
          }
          if (params.ok) {
            prof.lastVerifiedAt = params.testedAt;
          }
          prof.configurationHash = params.configurationHash;
          prof.updatedAt = params.testedAt;
        }
      }
    }

    // Also update credential records
    const legacyKey = `${params.ownerUid}:${params.providerType}`;
    const connKey = params.connectionId ? `${params.ownerUid}:${params.connectionId}` : legacyKey;
    for (const k of [connKey, legacyKey]) {
      const dRec = this.diskState.credentials[k];
      if (dRec) {
        dRec.lastTestedAt = params.testedAt;
        dRec.lastTestStatus = params.ok ? 'success' : 'failed';
      }
      const sRec = this.sessionCredentials.get(k);
      if (sRec) {
        sRec.lastTestedAt = params.testedAt;
        sRec.lastTestStatus = params.ok ? 'success' : 'failed';
      }
    }

    this.flushToDisk();
  }

  public deleteConnection(
    ownerUid: string,
    connectionIdOrProvider: string,
    force: boolean = false
  ): { deleted: boolean; affectedTasks: AITaskType[] } {
    const ws = this.getWorkspace(ownerUid);
    const targetConn = ws.connections.find(
      (c) => c.id === connectionIdOrProvider || c.providerType === connectionIdOrProvider
    );

    const affectedTasks: AITaskType[] = [];
    if (targetConn) {
      const profileIds = new Set(
        ws.modelProfiles.filter((p) => p.connectionId === targetConn.id).map((p) => p.id)
      );
      for (const [tKey, binding] of Object.entries(ws.taskBindings)) {
        if (
          (binding.primaryModelProfileId && profileIds.has(binding.primaryModelProfileId)) ||
          (binding.fallbackModelProfileId && profileIds.has(binding.fallbackModelProfileId))
        ) {
          affectedTasks.push(tKey as AITaskType);
        }
      }

      if (affectedTasks.length > 0 && !force) {
        throw new SecurityError(
          'EVALUATION_CONFLICT',
          `该连接下的模型仍被任务 [${affectedTasks.join(', ')}] 绑定。请先解绑任务或确认强制删除。`,
          409
        );
      }
    }

    const pWs = this.getOrCreatePersistentWorkspace(ownerUid);
    const sWs = this.sessionWorkspaces.get(ownerUid);

    for (const w of [pWs, sWs].filter(Boolean) as UserAIWorkspaceConfig[]) {
      const removedConnIds = new Set(
        w.connections
          .filter(
            (c) => c.id === connectionIdOrProvider || c.providerType === connectionIdOrProvider
          )
          .map((c) => c.id)
      );
      const removedProfIds = new Set(
        w.modelProfiles
          .filter((p) => removedConnIds.has(p.connectionId))
          .map((p) => p.id)
      );

      w.connections = w.connections.filter((c) => !removedConnIds.has(c.id));
      w.modelProfiles = w.modelProfiles.filter((p) => !removedProfIds.has(p.id));

      if (w.defaultModelProfileId && removedProfIds.has(w.defaultModelProfileId)) {
        w.defaultModelProfileId = w.modelProfiles[0]?.id || null;
      }

      for (const tKey of ALL_AI_TASK_TYPES) {
        const b = w.taskBindings[tKey];
        if (!b) continue;
        if (b.primaryModelProfileId && removedProfIds.has(b.primaryModelProfileId)) {
          b.primaryModelProfileId = null;
        }
        if (b.fallbackModelProfileId && removedProfIds.has(b.fallbackModelProfileId)) {
          b.fallbackModelProfileId = null;
        }
      }

      for (const cId of removedConnIds) {
        delete this.diskState.credentials[`${ownerUid}:${cId}`];
        this.sessionCredentials.delete(`${ownerUid}:${cId}`);
      }
    }

    delete this.diskState.credentials[`${ownerUid}:${connectionIdOrProvider}`];
    this.sessionCredentials.delete(`${ownerUid}:${connectionIdOrProvider}`);
    this.flushToDisk();

    return { deleted: true, affectedTasks };
  }

  public getDecryptedCredential(
    ownerUid: string,
    connectionIdOrProvider: string
  ): { plainKey: string; record: EncryptedCredentialRecord } | null {
    const key = `${ownerUid}:${connectionIdOrProvider}`;
    const rec =
      this.diskState.credentials[key] || this.sessionCredentials.get(key);
    if (!rec) return null;
    const plainKey = decryptProviderApiKey(ownerUid, rec.provider, rec);
    return { plainKey, record: rec };
  }

  public getProviderCredentialStatuses(ownerUid: string): Array<{
    provider: ProviderType;
    configured: boolean;
    storageMode: 'none' | 'session-cookie' | 'encrypted-firestore' | 'owner-env';
    maskedKey: string | null;
    baseUrl?: string;
    model: string;
    lastTestedAt: string | null;
    lastTestStatus: 'success' | 'failed' | 'untested';
    connectionId?: string;
    displayName?: string;
    configurationHash?: string;
  }> {
    const ws = this.getWorkspace(ownerUid);
    const providers: ProviderType[] = ['gemini', 'deepseek', 'openai-compatible'];

    return providers.map((prov) => {
      // Prefer the connection corresponding to defaultModelProfileId if it matches this provider, else latest connection for this provider
      const defaultProf = ws.modelProfiles.find((p) => p.id === ws.defaultModelProfileId);
      const matchingConns = ws.connections.filter((c) => c.providerType === prov && c.enabled);
      const activeConn =
        (defaultProf && matchingConns.find((c) => c.id === defaultProf.connectionId)) ||
        matchingConns[matchingConns.length - 1];

      const rec =
        (activeConn
          ? this.diskState.credentials[`${ownerUid}:${activeConn.id}`] ||
            this.sessionCredentials.get(`${ownerUid}:${activeConn.id}`)
          : null) ||
        this.diskState.credentials[`${ownerUid}:${prov}`] ||
        this.sessionCredentials.get(`${ownerUid}:${prov}`);

      if (!rec && !activeConn) {
        return {
          provider: prov,
          configured: false,
          storageMode: 'none',
          maskedKey: null,
          model: '',
          lastTestedAt: null,
          lastTestStatus: 'untested',
        };
      }

      const isSession = Boolean(
        (activeConn && activeConn.storageMode === 'session-only') ||
          this.sessionCredentials.has(`${ownerUid}:${prov}`)
      );

      const statusVal = rec?.lastTestStatus || activeConn?.lastTestStatus || 'untested';
      return {
        provider: prov,
        configured: true,
        storageMode: isSession ? 'session-cookie' : 'encrypted-firestore',
        maskedKey: rec?.maskedKey || activeConn?.maskedKey || null,
        baseUrl: rec?.baseUrl || activeConn?.baseUrl,
        model: rec?.model || defaultProf?.modelId || '',
        lastTestedAt: rec?.lastTestedAt || activeConn?.lastTestedAt || null,
        lastTestStatus: statusVal === 'invalidated' ? 'untested' : statusVal,
        connectionId: activeConn?.id || rec?.connectionId,
        displayName: activeConn?.displayName,
        configurationHash: rec?.configurationHash || activeConn?.configurationHash,
      };
    });
  }

  /**
   * Resolves which ModelProfile and ProviderConnection should execute a specific AITaskType.
   * Priority:
   * 1. Explicit `requestedProfileId` if passed by user
   * 2. `taskBindings[taskType].primaryModelProfileId`
   * 3. `workspace.defaultModelProfileId`
   * 4. Explicit `requestedProvider` if passed for backward compatibility
   * Never silently picks "the first configured provider" when multiple connections exist without a default!
   */
  public resolveTaskModelBinding(params: {
    ownerUid: string;
    taskType: AITaskType;
    requestedProfileId?: string;
    requestedProvider?: ProviderType;
    useFallback?: boolean;
  }): {
    connection: ProviderConnection;
    profile: ModelProfile;
    binding: TaskBindingConfig;
    plainApiKey: string;
  } | null {
    const ws = this.getWorkspace(params.ownerUid);
    const binding =
      ws.taskBindings[params.taskType] || createDefaultTaskBindings(ws.defaultModelProfileId)[params.taskType];

    const candidateProfileId = params.useFallback
      ? binding.fallbackModelProfileId
      : params.requestedProfileId ||
        binding.primaryModelProfileId ||
        ws.defaultModelProfileId;

    let profile: ModelProfile | undefined;
    if (candidateProfileId) {
      profile = ws.modelProfiles.find((p) => p.id === candidateProfileId && p.enabled);
    }
    if (!profile && params.requestedProvider) {
      // Only match explicit requestedProvider if default matches or only one profile for that provider exists
      profile = ws.modelProfiles.find(
        (p) => p.providerType === params.requestedProvider && p.enabled
      );
    }

    if (!profile) {
      return null;
    }

    const connection = ws.connections.find(
      (c) => c.id === profile!.connectionId && c.enabled
    );
    if (!connection) {
      return null;
    }

    const cred =
      this.getDecryptedCredential(params.ownerUid, connection.id) ||
      this.getDecryptedCredential(params.ownerUid, connection.providerType);
    if (!cred) {
      return null;
    }

    return {
      connection,
      profile,
      binding,
      plainApiKey: cred.plainKey,
    };
  }

  // EvaluationRun persistence
  public saveEvaluationRun(run: EvaluationRun): void {
    this.diskState.evaluationRuns[run.runId] = run;
    if (run.estimatedCostUsd && run.estimatedCostUsd > 0) {
      const ws = this.getOrCreatePersistentWorkspace(run.userId);
      ws.dailySpentUsd = Math.round((ws.dailySpentUsd + run.estimatedCostUsd) * 10000) / 10000;
    }
    this.flushToDisk();
  }

  public getEvaluationRun(ownerUid: string, runId: string): EvaluationRun | null {
    const run = this.diskState.evaluationRuns[runId];
    if (!run) return null;
    if (run.userId !== ownerUid) {
      throw new SecurityError('FORBIDDEN_USER_MISMATCH', '无权访问其他用户的批改运行记录', 403);
    }
    return run;
  }

  public listEvaluationRuns(ownerUid: string, limit: number = 30): EvaluationRun[] {
    return Object.values(this.diskState.evaluationRuns)
      .filter((r) => r.userId === ownerUid)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }

  // Authoritative Attempt Submission State (for Server Anti-Leakage)
  public markAttemptSubmitted(params: {
    ownerUid: string;
    attemptId: string;
    year: number;
    submittedQuestions?: number[];
    submittedAll?: boolean;
  }): AttemptSubmissionRecord {
    const key = `${params.ownerUid}:${params.attemptId}`;
    const existing = this.diskState.submissions[key];
    const mergedQuestions = Array.from(
      new Set([...(existing?.submittedQuestions || []), ...(params.submittedQuestions || [])])
    );
    const record: AttemptSubmissionRecord = {
      ownerUid: params.ownerUid,
      attemptId: params.attemptId,
      year: params.year,
      submittedQuestions: mergedQuestions,
      submittedAll: params.submittedAll ?? existing?.submittedAll ?? true,
      submittedAt: new Date().toISOString(),
    };
    this.diskState.submissions[key] = record;
    this.flushToDisk();
    return record;
  }

  public isQuestionSubmittedAuthoritative(params: {
    ownerUid: string;
    attemptId?: string;
    year?: number;
    questionNumber: number;
  }): boolean {
    if (params.attemptId) {
      const rec = this.diskState.submissions[`${params.ownerUid}:${params.attemptId}`];
      if (rec) {
        return rec.submittedAll || rec.submittedQuestions.includes(params.questionNumber);
      }
    }
    // Check if any submitted attempt for this user & year covers this question
    if (params.year) {
      for (const rec of Object.values(this.diskState.submissions)) {
        if (rec.ownerUid === params.ownerUid && rec.year === params.year) {
          if (rec.submittedAll || rec.submittedQuestions.includes(params.questionNumber)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // Idempotency Cache with TTL
  public getIdempotentResponse(
    ownerUid: string,
    compositeKey: string
  ): { status: number; body: unknown } | null {
    const entry = this.diskState.idempotencyRecords[compositeKey];
    if (!entry) return null;
    if (entry.ownerUid !== ownerUid) return null;
    if (Date.now() > entry.expiresAt) {
      delete this.diskState.idempotencyRecords[compositeKey];
      return null;
    }
    return { status: entry.status, body: entry.body };
  }

  public setIdempotentResponse(
    ownerUid: string,
    compositeKey: string,
    status: number,
    body: unknown,
    ttlMs: number = 24 * 60 * 60 * 1000
  ): void {
    const now = Date.now();
    this.diskState.idempotencyRecords[compositeKey] = {
      compositeKey,
      ownerUid,
      createdAt: now,
      expiresAt: now + ttlMs,
      status,
      body,
    };
    this.flushToDisk();
  }
}
