import crypto from 'node:crypto';
import path from 'node:path';
import type {
  AITaskType,
  EvaluationRun,
  ModelProfile,
  ProviderConnection,
  ProviderCredentialStatus,
  ProviderType,
  TaskBindingConfig,
  UserAIWorkspaceConfig,
} from '../domain/ai.ts';
import { SqliteBackingStore } from './db/sqliteStore.ts';
import {
  type EncryptedCredentialRecord,
  SecurityError,
  computeConfigurationHash,
  decryptProviderApiKey,
  encryptProviderApiKey,
  maskApiKey,
  normalizeProviderBaseUrl,
} from './securityAndCrypto.ts';

export const SERVER_GEMINI_CONNECTION_ID = 'conn-google-aistudio-env';
export const SERVER_GEMINI_PROFILE_ID = 'prof-google-aistudio-gemini';

export const ALL_AI_TASK_TYPES: AITaskType[] = [
  'objective_explanation',
  'subjective_stage1',
  'subjective_stage2',
  'visual_writing',
  'followup_chat',
  'writing_scaffold',
  'mistake_summary',
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
    mistake_summary: {
      taskType: 'mistake_summary',
      primaryModelProfileId: defaultProfileId,
      fallbackModelProfileId: null,
      timeoutMs: 45000,
      retryBudget: 1,
      temperature: 0.25,
      maxOutputTokens: 3500,
      structuredOutputStrategy: 'prompt_only',
      promptVersion: 'yanjuan-mistake-summary-v1.0',
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
  paperId?: string;
  submittedQuestions: number[];
  submittedAll: boolean;
  submittedAt: string;
}

/**
 * Persistent store backed by Node 24 native `node:sqlite` (WAL mode + ACID transactions)
 * for user AI connections, model profiles, task bindings, AES-256-GCM encrypted credentials,
 * evaluation runs, and authoritative exam submission states.
 * - `persistent-encrypted` records persist durably in SQLite across restarts.
 * - `session-only` records remain strictly in process memory.
 * - `GEMINI_API_KEY` env var (Google AI Studio) injects a read-only `server-env` virtual connection.
 */
export class PersistentAIStore {
  public readonly storeFilePath: string;
  private readonly sqlite: SqliteBackingStore;
  private readonly sessionCredentials = new Map<string, EncryptedCredentialRecord>();
  private readonly sessionWorkspaces = new Map<string, UserAIWorkspaceConfig>();

  constructor(storeFilePath?: string) {
    this.storeFilePath =
      storeFilePath || path.join(process.cwd(), 'data', 'runtime', 'yanjuan.db');
    this.sqlite = new SqliteBackingStore(storeFilePath);
  }

  public getSqlitePath(): string {
    return this.sqlite.dbPath;
  }

  public didMigrateLegacyJson(): boolean {
    return this.sqlite.migratedFromLegacyJson;
  }

  public close(): void {
    this.sqlite.close();
  }

  private buildServerEnvGeminiEntry(ownerUid: string): {
    connection: ProviderConnection;
    profile: ModelProfile;
  } | null {
    const envKey = process.env.GEMINI_API_KEY?.trim();
    if (!envKey) return null;

    const modelId = process.env.GEMINI_DEFAULT_MODEL?.trim() || 'gemini-2.5-flash';
    const baseUrl = normalizeProviderBaseUrl('gemini');
    const now = new Date().toISOString();
    const masked = maskApiKey(envKey);
    const configHash = computeConfigurationHash({
      connectionId: SERVER_GEMINI_CONNECTION_ID,
      providerType: 'gemini',
      baseUrl,
      modelId,
      protocolMode: 'gemini-native',
      credentialFingerprint: masked,
    });

    const connection: ProviderConnection = {
      id: SERVER_GEMINI_CONNECTION_ID,
      ownerUid,
      providerType: 'gemini',
      displayName: 'Google AI Studio 内置 Gemini',
      baseUrl,
      protocolMode: 'gemini-native',
      authenticationType: 'x-goog-api-key',
      credentialReference: 'env:GEMINI_API_KEY',
      maskedKey: masked,
      storageMode: 'server-env',
      readOnly: true,
      envVarName: 'GEMINI_API_KEY',
      enabled: true,
      configurationHash: configHash,
      lastTestStatus: 'success',
      lastTestedAt: now,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    };

    const profile: ModelProfile = {
      id: SERVER_GEMINI_PROFILE_ID,
      connectionId: SERVER_GEMINI_CONNECTION_ID,
      ownerUid,
      providerType: 'gemini',
      modelId,
      displayName: `${modelId} (Server Env)`,
      source: 'server-env',
      capabilities: {
        text: true,
        structuredOutput: true,
        jsonSchema: true,
        jsonObject: true,
        vision: true,
        streaming: true,
        reasoning: true,
      },
      capabilitySource: {
        text: 'verified',
        structuredOutput: 'verified',
        vision: 'verified',
        streaming: 'verified',
        reasoning: 'verified',
      },
      contextWindow: 1048576,
      outputLimit: 65536,
      structuredOutputStrategy: 'json_schema',
      defaultParameters: {
        temperature: 0.2,
        maxOutputTokens: 4096,
        timeoutMs: 35000,
      },
      configurationHash: configHash,
      lastVerifiedAt: now,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    return { connection, profile };
  }

  private getOrCreatePersistentWorkspace(ownerUid: string): UserAIWorkspaceConfig {
    let ws = this.sqlite.getWorkspace(ownerUid);
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
      this.sqlite.saveWorkspace(ownerUid, ws);
    }
    return ws;
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

  public getWorkspace(ownerUid: string): UserAIWorkspaceConfig {
    const persistentWs = this.getOrCreatePersistentWorkspace(ownerUid);
    const sessionWs = this.sessionWorkspaces.get(ownerUid);
    const serverEnvEntry = this.buildServerEnvGeminiEntry(ownerUid);

    const connMap = new Map<string, ProviderConnection>();
    if (serverEnvEntry) {
      connMap.set(serverEnvEntry.connection.id, serverEnvEntry.connection);
    }
    for (const c of persistentWs.connections) connMap.set(c.id, c);
    if (sessionWs) {
      for (const c of sessionWs.connections) connMap.set(c.id, c);
    }

    const profMap = new Map<string, ModelProfile>();
    if (serverEnvEntry) {
      profMap.set(serverEnvEntry.profile.id, serverEnvEntry.profile);
    }
    for (const p of persistentWs.modelProfiles) profMap.set(p.id, p);
    if (sessionWs) {
      for (const p of sessionWs.modelProfiles) profMap.set(p.id, p);
    }

    const defaultModelProfileId =
      sessionWs?.defaultModelProfileId ||
      persistentWs.defaultModelProfileId ||
      serverEnvEntry?.profile.id ||
      null;

    return {
      ...persistentWs,
      defaultModelProfileId,
      connections: Array.from(connMap.values()),
      modelProfiles: Array.from(profMap.values()),
      taskBindings: {
        ...createDefaultTaskBindings(defaultModelProfileId),
        ...persistentWs.taskBindings,
        ...(sessionWs ? sessionWs.taskBindings : {}),
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
    if (params.connectionId === SERVER_GEMINI_CONNECTION_ID) {
      throw new SecurityError(
        'INTERNAL_CONFIGURATION_ERROR',
        'Google AI Studio 服务端注入连接为只读模式，不可直接覆盖',
        403
      );
    }

    const nowIso = new Date().toISOString();
    const normalizedBase = normalizeProviderBaseUrl(params.providerType, params.baseUrl);
    const protocolMode =
      params.protocolMode ||
      (params.providerType === 'gemini' ? 'gemini-native' : 'chat-completions');
    const connId =
      params.connectionId || `conn-${params.providerType}-${crypto.randomBytes(4).toString('hex')}`;
    const credKey = `${params.ownerUid}:${connId}`;

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
        this.sqlite.upsertCredential(credKey, params.ownerUid, connId, params.providerType, encRecord);
      } else {
        this.sessionCredentials.set(credKey, encRecord);
      }
    } else {
      encRecord =
        this.sqlite.getCredential(credKey) ||
        this.sessionCredentials.get(credKey) ||
        this.sqlite.getCredential(`${params.ownerUid}:${params.providerType}`) ||
        this.sessionCredentials.get(`${params.ownerUid}:${params.providerType}`) ||
        undefined;

      if (!encRecord) {
        throw new SecurityError(
          'PROVIDER_CREDENTIAL_MISSING',
          '新建连接必须提供有效的 API Key',
          400
        );
      }

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

      if (params.storageMode === 'persistent-encrypted') {
        this.sqlite.upsertCredential(credKey, params.ownerUid, connId, params.providerType, encRecord);
      } else {
        this.sessionCredentials.set(credKey, encRecord);
      }
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
      this.sqlite.saveWorkspace(params.ownerUid, targetWs);
    }

    return {
      connection,
      profile,
      workspace: this.getWorkspace(params.ownerUid),
    };
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
    this.sqlite.saveWorkspace(ownerUid, pWs);

    const sWs = this.sessionWorkspaces.get(ownerUid);
    if (sWs) {
      sWs.defaultModelProfileId = profileId;
    }
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
    this.sqlite.saveWorkspace(ownerUid, pWs);
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
    const pWs = this.getOrCreatePersistentWorkspace(params.ownerUid);
    const sWs = this.sessionWorkspaces.get(params.ownerUid);

    this.sqlite.withTransaction(() => {
      for (const targetWs of [pWs, sWs].filter(Boolean) as UserAIWorkspaceConfig[]) {
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

      this.sqlite.saveWorkspace(params.ownerUid, pWs);

      if (params.connectionId) {
        const credKey = `${params.ownerUid}:${params.connectionId}`;
        const dRec = this.sqlite.getCredential(credKey);
        if (dRec) {
          dRec.lastTestedAt = params.testedAt;
          dRec.lastTestStatus = params.ok ? 'success' : 'failed';
          this.sqlite.upsertCredential(
            credKey,
            params.ownerUid,
            params.connectionId,
            dRec.provider,
            dRec
          );
        }
        const sRec = this.sessionCredentials.get(credKey);
        if (sRec) {
          sRec.lastTestedAt = params.testedAt;
          sRec.lastTestStatus = params.ok ? 'success' : 'failed';
        }
      }
    });
  }

  public deleteConnection(
    ownerUid: string,
    connectionIdOrProvider: string,
    force: boolean = false
  ): { deleted: boolean; affectedTasks: AITaskType[] } {
    if (connectionIdOrProvider === SERVER_GEMINI_CONNECTION_ID) {
      throw new SecurityError(
        'INTERNAL_CONFIGURATION_ERROR',
        'Google AI Studio 环境变量注入连接（server-env）为只读模式，不可删除',
        403
      );
    }

    const ws = this.getWorkspace(ownerUid);
    const targetConn = ws.connections.find(
      (c) =>
        (c.id === connectionIdOrProvider || c.providerType === connectionIdOrProvider) &&
        c.id !== SERVER_GEMINI_CONNECTION_ID
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

    this.sqlite.withTransaction(() => {
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
          this.sqlite.deleteCredentialsByConnection(ownerUid, cId);
          this.sessionCredentials.delete(`${ownerUid}:${cId}`);
        }
      }

      this.sqlite.deleteCredential(`${ownerUid}:${connectionIdOrProvider}`);
      this.sessionCredentials.delete(`${ownerUid}:${connectionIdOrProvider}`);
      this.sqlite.saveWorkspace(ownerUid, pWs);
    });

    return { deleted: true, affectedTasks };
  }

  public getDecryptedCredential(
    ownerUid: string,
    connectionIdOrProvider: string
  ): { plainKey: string; record?: EncryptedCredentialRecord } | null {
    if (connectionIdOrProvider === SERVER_GEMINI_CONNECTION_ID) {
      const envKey = process.env.GEMINI_API_KEY?.trim();
      return envKey ? { plainKey: envKey } : null;
    }

    const key = `${ownerUid}:${connectionIdOrProvider}`;
    const rec = this.sqlite.getCredential(key) || this.sessionCredentials.get(key);
    if (!rec) return null;
    const plainKey = decryptProviderApiKey(ownerUid, rec.provider, rec);
    return { plainKey, record: rec };
  }

  public getProviderCredentialStatuses(ownerUid: string): ProviderCredentialStatus[] {
    const ws = this.getWorkspace(ownerUid);
    const providers: ProviderType[] = ['gemini', 'deepseek', 'openai-compatible'];

    return providers.map((prov) => {
      const defaultProf = ws.modelProfiles.find((p) => p.id === ws.defaultModelProfileId);
      const matchingConns = ws.connections.filter((c) => c.providerType === prov && c.enabled);
      const activeConn =
        (defaultProf && matchingConns.find((c) => c.id === defaultProf.connectionId)) ||
        matchingConns[matchingConns.length - 1];

      if (activeConn && activeConn.storageMode === 'server-env') {
        const modelProf = ws.modelProfiles.find((p) => p.connectionId === activeConn.id);
        return {
          provider: prov,
          configured: true,
          storageMode: 'server-env',
          maskedKey: activeConn.maskedKey,
          baseUrl: activeConn.baseUrl,
          model: modelProf?.modelId || process.env.GEMINI_DEFAULT_MODEL || 'gemini-2.5-flash',
          lastTestedAt: activeConn.lastTestedAt,
          lastTestStatus: 'success',
          connectionId: activeConn.id,
          displayName: activeConn.displayName,
          configurationHash: activeConn.configurationHash,
          readOnly: true,
        };
      }

      const rec =
        (activeConn
          ? this.sqlite.getCredential(`${ownerUid}:${activeConn.id}`) ||
            this.sessionCredentials.get(`${ownerUid}:${activeConn.id}`)
          : null) ||
        this.sqlite.getCredential(`${ownerUid}:${prov}`) ||
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
          (activeConn && this.sessionCredentials.has(`${ownerUid}:${activeConn.id}`)) ||
          this.sessionCredentials.has(`${ownerUid}:${prov}`)
      );

      const statusVal = rec?.lastTestStatus || activeConn?.lastTestStatus || 'untested';
      const activeProf = activeConn
        ? ws.modelProfiles.find((p) => p.connectionId === activeConn.id)
        : defaultProf;
      return {
        provider: prov,
        configured: true,
        storageMode: isSession ? 'session-cookie' : 'encrypted-sqlite',
        maskedKey: rec?.maskedKey || activeConn?.maskedKey || null,
        baseUrl: rec?.baseUrl || activeConn?.baseUrl,
        model: rec?.model || activeProf?.modelId || '',
        lastTestedAt: rec?.lastTestedAt || activeConn?.lastTestedAt || null,
        lastTestStatus: statusVal === 'invalidated' ? 'untested' : statusVal,
        connectionId: activeConn?.id || rec?.connectionId,
        displayName: activeConn?.displayName,
        configurationHash: rec?.configurationHash || activeConn?.configurationHash,
      };
    });
  }

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
      ws.taskBindings[params.taskType] ||
      createDefaultTaskBindings(ws.defaultModelProfileId)[params.taskType];

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

    if (connection.storageMode === 'server-env' || connection.id === SERVER_GEMINI_CONNECTION_ID) {
      const envKey = process.env.GEMINI_API_KEY?.trim();
      if (!envKey) return null;
      return {
        connection,
        profile,
        binding,
        plainApiKey: envKey,
      };
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

  public saveEvaluationRun(run: EvaluationRun): void {
    this.sqlite.withTransaction(() => {
      this.sqlite.saveEvaluationRun(run);
      if (run.estimatedCostUsd && run.estimatedCostUsd > 0) {
        const ws = this.getOrCreatePersistentWorkspace(run.userId);
        ws.dailySpentUsd = Math.round((ws.dailySpentUsd + run.estimatedCostUsd) * 10000) / 10000;
        this.sqlite.saveWorkspace(run.userId, ws);
      }
    });
  }

  public getEvaluationRun(ownerUid: string, runId: string): EvaluationRun | null {
    const run = this.sqlite.getEvaluationRun(runId);
    if (!run) return null;
    if (run.userId !== ownerUid) {
      throw new SecurityError('FORBIDDEN_USER_MISMATCH', '无权访问其他用户的批改运行记录', 403);
    }
    return run;
  }

  public listEvaluationRuns(ownerUid: string, limit: number = 30): EvaluationRun[] {
    return this.sqlite.listEvaluationRuns(ownerUid, limit);
  }

  public markAttemptSubmitted(params: {
    ownerUid: string;
    attemptId: string;
    year: number;
    paperId?: string;
    submittedQuestions?: number[];
    submittedAll?: boolean;
  }): AttemptSubmissionRecord {
    const key = `${params.ownerUid}:${params.attemptId}`;
    const existing = this.sqlite.getSubmission(key);
    const mergedQuestions = Array.from(
      new Set([...(existing?.submittedQuestions || []), ...(params.submittedQuestions || [])])
    );
    const record: AttemptSubmissionRecord = {
      ownerUid: params.ownerUid,
      attemptId: params.attemptId,
      year: params.year,
      paperId: params.paperId || existing?.paperId,
      submittedQuestions: mergedQuestions,
      submittedAll: params.submittedAll ?? existing?.submittedAll ?? true,
      submittedAt: new Date().toISOString(),
    };
    this.sqlite.saveSubmission(key, record);
    return record;
  }

  public isQuestionSubmittedAuthoritative(params: {
    ownerUid: string;
    attemptId?: string;
    year?: number;
    questionNumber: number;
  }): boolean {
    if (params.attemptId) {
      const rec = this.sqlite.getSubmission(`${params.ownerUid}:${params.attemptId}`);
      if (rec) {
        return rec.submittedAll || rec.submittedQuestions.includes(params.questionNumber);
      }
    }
    if (params.year) {
      const list = this.sqlite.listSubmissionsByOwnerAndYear(params.ownerUid, params.year);
      for (const rec of list) {
        if (rec.submittedAll || rec.submittedQuestions.includes(params.questionNumber)) {
          return true;
        }
      }
    }
    return false;
  }

  public getIdempotentResponse(
    ownerUid: string,
    compositeKey: string
  ): { status: number; body: unknown } | null {
    const entry = this.sqlite.getIdempotentResponse(ownerUid, compositeKey);
    if (!entry) return null;
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
    this.sqlite.saveIdempotentResponse(compositeKey, {
      compositeKey,
      ownerUid,
      createdAt: now,
      expiresAt: now + ttlMs,
      status,
      body,
    });
  }
}
