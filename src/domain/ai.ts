/**
 * Four-layer AI architecture contracts:
 * ProviderConnection -> ModelProfile -> TaskBindingConfig -> EvaluationRun.
 */

export type AIErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_TOKEN_INVALID'
  | 'PROVIDER_CREDENTIAL_MISSING'
  | 'PROVIDER_AUTH_FAILED'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_LIST_UNSUPPORTED'
  | 'MODEL_CAPABILITY_MISMATCH'
  | 'STRUCTURED_OUTPUT_UNSUPPORTED'
  | 'STRUCTURED_OUTPUT_INVALID'
  | 'VISION_NOT_SUPPORTED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'REQUEST_CANCELLED'
  | 'BUDGET_EXCEEDED'
  | 'INVALID_BASE_URL'
  | 'UNSAFE_BASE_URL'
  | 'EVALUATION_CONFLICT'
  | 'DATA_ANSWER_DISPUTED'
  | 'INTERNAL_CONFIGURATION_ERROR';

export type ProviderType = 'gemini' | 'deepseek' | 'openai-compatible';

export type CapabilitySource =
  | 'provider'
  | 'verified'
  | 'inferred'
  | 'manual'
  | 'unknown';

export type StructuredOutputStrategy =
  | 'json_schema'
  | 'json_object'
  | 'prompt_only';

export type ProtocolMode = 'chat-completions' | 'gemini-native';

export type AITaskType =
  | 'objective_explanation'
  | 'subjective_stage1'
  | 'subjective_stage2'
  | 'visual_writing'
  | 'followup_chat'
  | 'writing_scaffold'
  | 'mistake_summary';

export type ConnectionStorageMode =
  | 'persistent-encrypted'
  | 'session-only'
  | 'server-env'
  | 'owner-env';

export interface ProviderConnection {
  id: string;
  ownerUid: string;
  providerType: ProviderType;
  displayName: string;
  baseUrl: string;
  protocolMode: ProtocolMode;
  authenticationType: 'bearer' | 'x-goog-api-key';
  credentialReference: string;
  maskedKey: string;
  storageMode: ConnectionStorageMode;
  readOnly?: boolean;
  envVarName?: string;
  enabled: boolean;
  configurationHash: string;
  lastTestStatus: 'success' | 'failed' | 'untested' | 'invalidated';
  lastTestedAt: string | null;
  lastErrorCode?: AIErrorCode | null;
  lastErrorMessage?: string | null;
  extraHeaders?: Record<string, string>;
  modelsListPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelCapabilityMatrix {
  text: boolean;
  structuredOutput: boolean;
  jsonSchema: boolean;
  jsonObject: boolean;
  vision: boolean;
  streaming: boolean;
  reasoning: boolean;
}

export interface ModelProfile {
  id: string;
  connectionId: string;
  ownerUid: string;
  providerType: ProviderType;
  modelId: string;
  displayName: string;
  source: 'provider-list' | 'manual' | 'server-env';
  capabilities: ModelCapabilityMatrix;
  capabilitySource: {
    text: CapabilitySource;
    structuredOutput: CapabilitySource;
    vision: CapabilitySource;
    streaming: CapabilitySource;
    reasoning: CapabilitySource;
  };
  contextWindow: number | null;
  outputLimit: number | null;
  structuredOutputStrategy: StructuredOutputStrategy;
  defaultParameters: {
    temperature: number;
    maxOutputTokens: number;
    timeoutMs: number;
  };
  configurationHash: string;
  lastVerifiedAt: string | null;
  lastTestLayers?: {
    basic?: { ok: boolean; latencyMs: number; testedAt: string; message: string };
    structured?: { ok: boolean; latencyMs: number; testedAt: string; message: string };
    vision?: { ok: boolean; latencyMs: number; testedAt: string; message: string };
    sample?: { ok: boolean; latencyMs: number; testedAt: string; message: string };
  };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskBindingConfig {
  taskType: AITaskType;
  primaryModelProfileId: string | null;
  fallbackModelProfileId: string | null;
  timeoutMs: number;
  retryBudget: number;
  temperature: number;
  maxOutputTokens: number;
  structuredOutputStrategy: StructuredOutputStrategy;
  promptVersion: string;
  allowTextFallbackForVision?: boolean;
  enabled: boolean;
  updatedAt: string;
}

export interface DiscoveredModelItem {
  modelId: string;
  displayName: string;
  providerType: ProviderType;
  source: 'provider-list';
  contextWindow: number | null;
  outputLimit: number | null;
  capabilities: Partial<ModelCapabilityMatrix>;
  capabilitySource: CapabilitySource;
  fetchedAt: string;
}

export interface ModelDiscoveryResult {
  connectionId?: string;
  providerType: ProviderType;
  normalizedBaseUrl: string;
  models: DiscoveredModelItem[];
  source: 'provider-api' | 'cached-provider-api';
  fetchedAt: string;
  expiresAt: string;
  supported: boolean;
  warningCode?: AIErrorCode;
  warningMessage?: string;
}

export interface MultiLayerTestLayerResult {
  layer: 'basic' | 'structured' | 'vision' | 'sample';
  ok: boolean;
  latencyMs: number;
  message: string;
  errorCode?: AIErrorCode;
  details?: string;
}

export interface MultiLayerTestResponse {
  ok: boolean;
  providerType: ProviderType;
  normalizedBaseUrl: string;
  modelId: string;
  protocolMode: ProtocolMode;
  configurationHash: string;
  testedAt: string;
  totalLatencyMs: number;
  layers: MultiLayerTestLayerResult[];
  verifiedCapabilities: Partial<ModelCapabilityMatrix>;
  capabilitySources: Partial<Record<keyof ModelCapabilityMatrix, CapabilitySource>>;
}

export interface TokenUsageSummary {
  promptTokens: number | null;
  completionTokens: number | null;
  cachedTokens: number | null;
  totalTokens: number | null;
  source: 'provider' | 'unknown';
}

export interface EvaluationRun {
  runId: string;
  userId: string;
  taskType: AITaskType;
  answerVersionId?: string;
  previousAnswerVersionId?: string | null;
  questionNumber?: number;
  inputHash: string;
  rubricHash: string;
  promptVersion: string;
  taskBindingVersion: string;
  modelProfileId: string;
  connectionId: string;
  provider: ProviderType;
  actualModelId: string;
  stage2ModelProfileId?: string | null;
  stage2Provider?: ProviderType | null;
  stage2ActualModelId?: string | null;
  status:
    | 'queued'
    | 'running-stage1'
    | 'stage1-ready'
    | 'running-stage2'
    | 'completed'
    | 'provisional-stage2-failed'
    | 'cancelled'
    | 'failed';
  startedAt: string;
  completedAt: string | null;
  stage1LatencyMs?: number;
  stage2LatencyMs?: number;
  latencyMs: number;
  retryCount: number;
  cacheStatus: 'miss' | 'hit' | 'bypassed';
  usage: TokenUsageSummary;
  stage2Usage?: TokenUsageSummary;
  estimatedCostUsd: number | null;
  finishReason: string | null;
  providerRequestId: string | null;
  usedVision: boolean;
  visionDegradedToText: boolean;
  stage1Result?: unknown;
  stage2Result?: unknown;
  finalResult?: unknown;
  safeErrorCode?: AIErrorCode | null;
  errorMessage?: string | null;
}

export interface UserAIWorkspaceConfig {
  ownerUid: string;
  defaultModelProfileId: string | null;
  connections: ProviderConnection[];
  modelProfiles: ModelProfile[];
  taskBindings: Record<AITaskType, TaskBindingConfig>;
  dailyBudgetUsd: number;
  dailySpentUsd: number;
  maxConcurrentJobs: number;
  updatedAt: string;
}

export interface ModelCapabilities {
  provider: ProviderType;
  displayName: string;
  defaultModel: string;
  supportsVision: boolean;
  supportsJsonObject: boolean;
  supportsJsonSchema: boolean;
  supportsStreaming: boolean;
  supportsReasoning: boolean;
  maxInput: number;
  maxOutput: number;
  capabilitySource?: CapabilitySource;
}

export type ProviderCredentialStatusStorageMode =
  | 'none'
  | 'session-cookie'
  | 'encrypted-sqlite'
  | 'encrypted-firestore'
  | 'server-env'
  | 'owner-env';

export interface ProviderCredentialStatus {
  provider: ProviderType;
  configured: boolean;
  storageMode: ProviderCredentialStatusStorageMode;
  maskedKey: string | null;
  baseUrl?: string;
  model: string;
  lastTestedAt: string | null;
  lastTestStatus: 'success' | 'failed' | 'untested';
  connectionId?: string;
  displayName?: string;
  configurationHash?: string;
  readOnly?: boolean;
}

export interface SystemCapabilitiesResponse {
  deploymentTarget: 'google-aistudio' | 'local-node';
  storageEngine: 'node:sqlite' | 'json-legacy';
  localFirstMode: boolean;
  hasServerGeminiKey: boolean;
  requiresServerPin: boolean;
  serverDefaultModel: string | null;
  supportedSubjects: ('english-i' | 'politics')[];
}
