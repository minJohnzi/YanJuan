import { GoogleGenAI } from '@google/genai';
import type {
  CapabilitySource,
  DiscoveredModelItem,
  ModelCapabilities,
  ModelCapabilityMatrix,
  ModelDiscoveryResult,
  MultiLayerTestLayerResult,
  MultiLayerTestResponse,
  ProtocolMode,
  ProviderType,
  StructuredOutputStrategy,
  TokenUsageSummary,
} from '../shared/types.ts';
import {
  SecurityError,
  computeConfigurationHash,
  normalizeProviderBaseUrl,
  safeExternalFetch,
  validateSafeCustomBaseUrl,
} from './securityAndCrypto.ts';

export interface MultimodalImageInput {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  base64Data: string;
}

export interface GenerateOptions {
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  images?: MultimodalImageInput[];
  structuredOutputStrategy?: StructuredOutputStrategy;
}

export interface ProviderCallTelemetry {
  usage: TokenUsageSummary;
  finishReason: string | null;
  providerRequestId: string | null;
  latencyMs: number;
  retryCount: number;
  strategyUsed?: StructuredOutputStrategy;
}

export interface ModelProvider {
  readonly providerId: ProviderType;
  readonly modelName: string;
  readonly baseUrl?: string;
  getCapabilities(): ModelCapabilities;
  testConnection(options?: {
    layers?: ('basic' | 'structured' | 'vision' | 'sample')[];
    timeoutMs?: number;
  }): Promise<{
    ok: boolean;
    latencyMs: number;
    message: string;
    multiLayerReport?: MultiLayerTestResponse;
  }>;
  discoverModels?(options?: { forceRefresh?: boolean }): Promise<ModelDiscoveryResult>;
  generateText(prompt: string, options?: GenerateOptions): Promise<string>;
  generateTextWithTelemetry?(
    prompt: string,
    options?: GenerateOptions
  ): Promise<{ text: string; telemetry: ProviderCallTelemetry }>;
  generateWithImages(
    prompt: string,
    images: MultimodalImageInput[],
    options?: GenerateOptions
  ): Promise<string>;
  generateStructured<T>(
    prompt: string,
    schemaDescription: string,
    validator: (raw: unknown) => { valid: boolean; errors: string[]; value?: T },
    options?: GenerateOptions & { maxRetries?: number }
  ): Promise<T>;
  generateStructuredWithTelemetry?<T>(
    prompt: string,
    schemaDescription: string,
    validator: (raw: unknown) => { valid: boolean; errors: string[]; value?: T },
    options?: GenerateOptions & { maxRetries?: number }
  ): Promise<{ value: T; telemetry: ProviderCallTelemetry }>;
}

interface CatalogCacheEntry {
  configurationHash: string;
  fetchedAt: string;
  expiresAtMs: number;
  result: ModelDiscoveryResult;
}

const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL
const modelDiscoveryCache = new Map<string, CatalogCacheEntry>();

export function clearModelDiscoveryCache(): void {
  modelDiscoveryCache.clear();
}

// 1x1 solid red PNG base64 for Layer 3 Vision Probe
const TINY_PROBE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export function extractJsonObject(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error('模型输出无法解析为有效 JSON 对象');
  }
}

function createAbortTimer(
  timeoutMs: number,
  externalSignal?: AbortSignal
): { controller: AbortController; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Timeout after ${timeoutMs}ms`));
  }, timeoutMs);

  const onAbort = () => controller.abort(new Error('Cancelled by caller'));
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      controller.abort(new Error('Cancelled by caller'));
    } else {
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }
  }

  return {
    controller,
    clear: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * Google Gemini Provider Adapter (@google/genai)
 * - Explicit timeout & AbortSignal enforcement
 * - True multimodal inlineData image transmission
 * - Real /models catalog listing without regex capability guessing
 * - 4-layer capability verification (basic, structured, vision, sample)
 */
export class GeminiModelProvider implements ModelProvider {
  public readonly providerId: ProviderType = 'gemini';
  public readonly modelName: string;
  public readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly verifiedCapabilities?: Partial<ModelCapabilityMatrix>;
  private readonly capabilitySource?: CapabilitySource;

  constructor(options: {
    apiKey: string;
    modelName?: string;
    baseUrl?: string;
    verifiedCapabilities?: Partial<ModelCapabilityMatrix>;
    capabilitySource?: CapabilitySource;
  }) {
    this.apiKey = options.apiKey.trim();
    this.modelName = (options.modelName || 'gemini-2.5-flash').trim();
    this.baseUrl = normalizeProviderBaseUrl('gemini', options.baseUrl);
    this.verifiedCapabilities = options.verifiedCapabilities;
    this.capabilitySource = options.capabilitySource;
  }

  public getCapabilities(): ModelCapabilities {
    // Never guess vision by model name substring; only report true if verified or explicitly declared
    return {
      provider: 'gemini',
      displayName: 'Google Gemini',
      defaultModel: this.modelName,
      supportsVision: this.verifiedCapabilities?.vision ?? false,
      supportsJsonObject: this.verifiedCapabilities?.jsonObject ?? true,
      supportsJsonSchema: this.verifiedCapabilities?.jsonSchema ?? true,
      supportsStreaming: this.verifiedCapabilities?.streaming ?? true,
      supportsReasoning: this.verifiedCapabilities?.reasoning ?? true,
      maxInput: 1048576,
      maxOutput: 65536,
      capabilitySource: this.capabilitySource || 'provider',
    };
  }

  public async discoverModels(options?: {
    forceRefresh?: boolean;
  }): Promise<ModelDiscoveryResult> {
    const configHash = computeConfigurationHash({
      providerType: 'gemini',
      baseUrl: this.baseUrl,
      credentialFingerprint: this.apiKey.slice(-6),
    });

    if (!options?.forceRefresh) {
      const cached = modelDiscoveryCache.get(configHash);
      if (cached && Date.now() < cached.expiresAtMs) {
        return {
          ...cached.result,
          source: 'cached-provider-api',
        };
      }
    }

    const now = new Date();
    const fetchedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + CATALOG_CACHE_TTL_MS).toISOString();

    try {
      const ai = new GoogleGenAI({ apiKey: this.apiKey });
      const pager = await ai.models.list();
      const models: DiscoveredModelItem[] = [];

      for await (const item of pager) {
        const rawId = item.name || '';
        const modelId = rawId.replace(/^models\//, '').trim();
        if (!modelId) continue;

        const actions = (item as { supportedActions?: string[] }).supportedActions;
        if (Array.isArray(actions) && actions.length > 0 && !actions.includes('generateContent')) {
          continue;
        }

        const contextWindow =
          typeof (item as { inputTokenLimit?: number }).inputTokenLimit === 'number'
            ? (item as { inputTokenLimit?: number }).inputTokenLimit!
            : null;
        const outputLimit =
          typeof (item as { outputTokenLimit?: number }).outputTokenLimit === 'number'
            ? (item as { outputTokenLimit?: number }).outputTokenLimit!
            : null;

        models.push({
          modelId,
          displayName: item.displayName ? `${item.displayName} (${modelId})` : modelId,
          providerType: 'gemini',
          source: 'provider-list',
          contextWindow,
          outputLimit,
          capabilities: {
            text: true,
            structuredOutput: true,
            jsonSchema: true,
            jsonObject: true,
            // Do not assume vision without probing or explicit metadata
            vision: false,
          },
          capabilitySource: 'provider',
          fetchedAt,
        });
      }

      const result: ModelDiscoveryResult = {
        providerType: 'gemini',
        normalizedBaseUrl: this.baseUrl,
        models,
        source: 'provider-api',
        fetchedAt,
        expiresAt,
        supported: models.length > 0,
        warningCode: models.length === 0 ? 'MODEL_LIST_UNSUPPORTED' : undefined,
        warningMessage:
          models.length === 0
            ? '未从 Gemini 接口获取到模型项，请使用“手动填写模型 ID”模式。'
            : undefined,
      };

      if (models.length > 0) {
        modelDiscoveryCache.set(configHash, {
          configurationHash: configHash,
          fetchedAt,
          expiresAtMs: now.getTime() + CATALOG_CACHE_TTL_MS,
          result,
        });
      }
      return result;
    } catch (err: any) {
      return {
        providerType: 'gemini',
        normalizedBaseUrl: this.baseUrl,
        models: [],
        source: 'provider-api',
        fetchedAt,
        expiresAt,
        supported: false,
        warningCode: 'MODEL_LIST_UNSUPPORTED',
        warningMessage: `获取 Gemini 模型列表未成功（${String(err?.message || err).slice(0, 100)}）。这不代表 API Key 不可用，请手动输入模型 ID 并点击“测试当前配置”。`,
      };
    }
  }

  public async generateTextWithTelemetry(
    prompt: string,
    options: GenerateOptions = {}
  ): Promise<{ text: string; telemetry: ProviderCallTelemetry }> {
    const startMs = Date.now();
    const timeoutMs = options.timeoutMs ?? 25000;
    const { controller, clear } = createAbortTimer(timeoutMs, options.signal);

    try {
      const ai = new GoogleGenAI({ apiKey: this.apiKey });
      const parts: Array<
        { text: string } | { inlineData: { mimeType: string; data: string } }
      > = [];

      if (options.images && options.images.length > 0) {
        for (const img of options.images) {
          parts.push({
            inlineData: {
              mimeType: img.mimeType,
              data: img.base64Data,
            },
          });
        }
      }
      parts.push({ text: prompt });

      const sdkCall = ai.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: options.systemInstruction,
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxOutputTokens ?? 4096,
          abortSignal: controller.signal,
        },
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        if (controller.signal.aborted) {
          reject(
            new SecurityError(
              options.signal?.aborted ? 'REQUEST_CANCELLED' : 'PROVIDER_TIMEOUT',
              options.signal?.aborted
                ? '请求已取消'
                : `Gemini 响应超时 (>${timeoutMs}ms)`,
              options.signal?.aborted ? 499 : 504
            )
          );
          return;
        }
        controller.signal.addEventListener(
          'abort',
          () => {
            reject(
              new SecurityError(
                options.signal?.aborted ? 'REQUEST_CANCELLED' : 'PROVIDER_TIMEOUT',
                options.signal?.aborted
                  ? '请求已取消'
                  : `Gemini 响应超时 (>${timeoutMs}ms)`,
                options.signal?.aborted ? 499 : 504
              )
            );
          },
          { once: true }
        );
      });

      const response = await Promise.race([sdkCall, timeoutPromise]);
      const text = response.text || '';
      if (!text.trim()) {
        throw new SecurityError('PROVIDER_UNAVAILABLE', 'Gemini 返回空内容', 502);
      }

      const usageMeta = response.usageMetadata;
      const usage: TokenUsageSummary = usageMeta
        ? {
            promptTokens: usageMeta.promptTokenCount ?? null,
            completionTokens: usageMeta.candidatesTokenCount ?? null,
            cachedTokens: (usageMeta as { cachedContentTokenCount?: number })
              .cachedContentTokenCount ?? null,
            totalTokens: usageMeta.totalTokenCount ?? null,
            source: 'provider',
          }
        : {
            promptTokens: null,
            completionTokens: null,
            cachedTokens: null,
            totalTokens: null,
            source: 'unknown',
          };

      return {
        text,
        telemetry: {
          usage,
          finishReason: response.candidates?.[0]?.finishReason
            ? String(response.candidates[0].finishReason)
            : 'STOP',
          providerRequestId:
            (response as { responseId?: string }).responseId || `gemini-${Date.now()}`,
          latencyMs: Date.now() - startMs,
          retryCount: 0,
        },
      };
    } finally {
      clear();
    }
  }

  public async generateText(prompt: string, options?: GenerateOptions): Promise<string> {
    const res = await this.generateTextWithTelemetry(prompt, options);
    return res.text;
  }

  public async generateWithImages(
    prompt: string,
    images: MultimodalImageInput[],
    options?: GenerateOptions
  ): Promise<string> {
    const res = await this.generateTextWithTelemetry(prompt, {
      ...options,
      images,
    });
    return res.text;
  }

  public async generateStructuredWithTelemetry<T>(
    prompt: string,
    schemaDescription: string,
    validator: (raw: unknown) => { valid: boolean; errors: string[]; value?: T },
    options: GenerateOptions & { maxRetries?: number } = {}
  ): Promise<{ value: T; telemetry: ProviderCallTelemetry }> {
    const startMs = Date.now();
    const maxRetries = options.maxRetries ?? 2;
    const timeoutMs = options.timeoutMs ?? 35000;
    const strategy: StructuredOutputStrategy =
      options.structuredOutputStrategy || 'json_object';

    let currentPrompt = `${prompt}\n\n请严格只输出符合以下 Schema 的 JSON 对象，严禁输出额外说明文字：\n${schemaDescription}`;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let hasProviderUsage = false;
    let lastFinishReason: string | null = 'STOP';
    let lastRequestId: string | null = null;
    let lastErrors: string[] = [];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const { controller, clear } = createAbortTimer(timeoutMs, options.signal);
      try {
        const ai = new GoogleGenAI({ apiKey: this.apiKey });
        const parts: Array<
          { text: string } | { inlineData: { mimeType: string; data: string } }
        > = [];

        if (options.images && options.images.length > 0) {
          for (const img of options.images) {
            parts.push({
              inlineData: {
                mimeType: img.mimeType,
                data: img.base64Data,
              },
            });
          }
        }
        parts.push({ text: currentPrompt });

        const response = await ai.models.generateContent({
          model: this.modelName,
          contents: [{ role: 'user', parts }],
          config: {
            systemInstruction: options.systemInstruction,
            temperature: options.temperature ?? 0.2,
            maxOutputTokens: options.maxOutputTokens ?? 4096,
            responseMimeType: strategy === 'prompt_only' ? undefined : 'application/json',
            abortSignal: controller.signal,
          },
        });

        const rawText = response.text || '';
        if (response.usageMetadata) {
          hasProviderUsage = true;
          totalPromptTokens += response.usageMetadata.promptTokenCount ?? 0;
          totalCompletionTokens += response.usageMetadata.candidatesTokenCount ?? 0;
        }
        lastFinishReason = response.candidates?.[0]?.finishReason
          ? String(response.candidates[0].finishReason)
          : 'STOP';
        lastRequestId =
          (response as { responseId?: string }).responseId || `gemini-${Date.now()}`;

        const parsed = extractJsonObject(rawText);
        const check = validator(parsed);
        if (check.valid && check.value !== undefined) {
          return {
            value: check.value,
            telemetry: {
              usage: hasProviderUsage
                ? {
                    promptTokens: totalPromptTokens,
                    completionTokens: totalCompletionTokens,
                    cachedTokens: null,
                    totalTokens: totalPromptTokens + totalCompletionTokens,
                    source: 'provider',
                  }
                : {
                    promptTokens: null,
                    completionTokens: null,
                    cachedTokens: null,
                    totalTokens: null,
                    source: 'unknown',
                  },
              finishReason: lastFinishReason,
              providerRequestId: lastRequestId,
              latencyMs: Date.now() - startMs,
              retryCount: attempt,
              strategyUsed: strategy,
            },
          };
        }
        lastErrors = check.errors;
      } catch (err: any) {
        if (err instanceof SecurityError) throw err;
        lastErrors = [err?.message || String(err)];
      } finally {
        clear();
      }

      currentPrompt = `${prompt}\n\n【格式修正重试 #${attempt + 1}】上次输出未通过校验：${lastErrors.join('；')}\n请严格只输出合法的 JSON 对象：\n${schemaDescription}`;
    }

    throw new SecurityError(
      'STRUCTURED_OUTPUT_INVALID',
      `Gemini 结构化输出校验未通过 (已重试 ${maxRetries} 次): ${lastErrors.join('; ')}`,
      422
    );
  }

  public async generateStructured<T>(
    prompt: string,
    schemaDescription: string,
    validator: (raw: unknown) => { valid: boolean; errors: string[]; value?: T },
    options?: GenerateOptions & { maxRetries?: number }
  ): Promise<T> {
    const res = await this.generateStructuredWithTelemetry(
      prompt,
      schemaDescription,
      validator,
      options
    );
    return res.value;
  }

  public async testConnection(options?: {
    layers?: ('basic' | 'structured' | 'vision' | 'sample')[];
    timeoutMs?: number;
  }): Promise<{
    ok: boolean;
    latencyMs: number;
    message: string;
    multiLayerReport?: MultiLayerTestResponse;
  }> {
    const report = await runMultiLayerCapabilityProbe(this, {
      providerType: 'gemini',
      normalizedBaseUrl: this.baseUrl,
      modelId: this.modelName,
      protocolMode: 'gemini-native',
      apiKeyFingerprint: this.apiKey.slice(-6),
      layers: options?.layers || ['basic', 'structured'],
      timeoutMs: options?.timeoutMs ?? 15000,
    });

    const summaryMsg = report.layers.map((l) => `${l.layer}: ${l.ok ? '通过' : '失败'}`).join(' | ');
    return {
      ok: report.ok,
      latencyMs: report.totalLatencyMs,
      message: report.ok ? `连接与能力验证通过 (${summaryMsg})` : `验证未通过 (${summaryMsg})`,
      multiLayerReport: report,
    };
  }
}

/**
 * DeepSeek & OpenAI-Compatible Provider Adapter
 * - Standardizes Base URL to avoid `/v1/v1/models` or `/v1/v1/chat/completions`
 * - Uses `safeExternalFetch` with SSRF protection, DNS rebinding guard, and redirect validation
 * - Implements real multimodal `image_url` data URLs in `generateWithImages` & `generateStructured`
 * - Supports 4-layer capability verification
 */
export class OpenAICompatibleModelProvider implements ModelProvider {
  public readonly providerId: ProviderType;
  public readonly modelName: string;
  public readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly verifiedCapabilities?: Partial<ModelCapabilityMatrix>;
  private readonly capabilitySource?: CapabilitySource;
  private readonly dnsLookupFn?: (hostname: string) => Promise<{ address: string }[]>;

  constructor(options: {
    providerId: 'deepseek' | 'openai-compatible';
    apiKey: string;
    modelName?: string;
    baseUrl?: string;
    verifiedCapabilities?: Partial<ModelCapabilityMatrix>;
    capabilitySource?: CapabilitySource;
    dnsLookupFn?: (hostname: string) => Promise<{ address: string }[]>;
  }) {
    this.providerId = options.providerId;
    this.apiKey = options.apiKey.trim();
    this.modelName = (
      options.modelName ||
      (options.providerId === 'deepseek' ? 'deepseek-chat' : '')
    ).trim();
    this.baseUrl = normalizeProviderBaseUrl(options.providerId, options.baseUrl);
    this.verifiedCapabilities = options.verifiedCapabilities;
    this.capabilitySource = options.capabilitySource;
    this.dnsLookupFn = options.dnsLookupFn;
  }

  public getCapabilities(): ModelCapabilities {
    // Never guess vision by model name regex! Only true if verified or explicitly declared.
    return {
      provider: this.providerId,
      displayName:
        this.providerId === 'deepseek' ? 'DeepSeek' : 'OpenAI Compatible',
      defaultModel: this.modelName,
      supportsVision: this.verifiedCapabilities?.vision ?? false,
      supportsJsonObject: this.verifiedCapabilities?.jsonObject ?? true,
      supportsJsonSchema: this.verifiedCapabilities?.jsonSchema ?? false,
      supportsStreaming: this.verifiedCapabilities?.streaming ?? true,
      supportsReasoning:
        this.verifiedCapabilities?.reasoning ?? this.providerId === 'deepseek',
      maxInput: 65536,
      maxOutput: 8192,
      capabilitySource: this.capabilitySource || 'unknown',
    };
  }

  private async buildEndpointUrl(suffix: '/models' | '/chat/completions'): Promise<string> {
    const normalized = normalizeProviderBaseUrl(this.providerId, this.baseUrl);
    const safeBase = await validateSafeCustomBaseUrl(normalized, this.dnsLookupFn);
    let clean = safeBase.replace(/\/+$/, '');
    if (!/\/v\d+$/i.test(clean)) {
      clean = `${clean}/v1`;
    }
    return `${clean}${suffix}`;
  }

  public async discoverModels(options?: {
    forceRefresh?: boolean;
  }): Promise<ModelDiscoveryResult> {
    const configHash = computeConfigurationHash({
      providerType: this.providerId,
      baseUrl: this.baseUrl,
      credentialFingerprint: this.apiKey.slice(-6),
    });

    if (!options?.forceRefresh) {
      const cached = modelDiscoveryCache.get(configHash);
      if (cached && Date.now() < cached.expiresAtMs) {
        return {
          ...cached.result,
          source: 'cached-provider-api',
        };
      }
    }

    const now = new Date();
    const fetchedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + CATALOG_CACHE_TTL_MS).toISOString();

    try {
      const url = await this.buildEndpointUrl('/models');
      const res = await safeExternalFetch(
        url,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
          },
        },
        {
          timeoutMs: 12000,
          dnsLookupFn: this.dnsLookupFn,
        }
      );

      if (res.status < 200 || res.status >= 300) {
        return {
          providerType: this.providerId,
          normalizedBaseUrl: this.baseUrl,
          models: [],
          source: 'provider-api',
          fetchedAt,
          expiresAt,
          supported: false,
          warningCode: 'MODEL_LIST_UNSUPPORTED',
          warningMessage: `模型列表接口返回 HTTP ${res.status}。部分网关或中转站不开放 /models，这不代表 API Key 无效，请使用“手动填写模型 ID”并点击测试。`,
        };
      }

      const parsed = JSON.parse(res.bodyText) as {
        data?: Array<{
          id?: string;
          context_window?: number;
          max_output_tokens?: number;
        }>;
      };
      const list = Array.isArray(parsed?.data) ? parsed.data : [];

      const models: DiscoveredModelItem[] = list
        .map((m) => {
          const id = typeof m?.id === 'string' ? m.id.trim() : '';
          if (!id) return null;
          return {
            modelId: id,
            displayName: id,
            providerType: this.providerId,
            source: 'provider-list' as const,
            contextWindow:
              typeof m.context_window === 'number' ? m.context_window : null,
            outputLimit:
              typeof m.max_output_tokens === 'number' ? m.max_output_tokens : null,
            capabilities: {
              text: true,
              // Do not assume vision or jsonSchema based on model name substring!
              vision: false,
              structuredOutput: true,
              jsonObject: true,
              jsonSchema: false,
            },
            capabilitySource: 'provider' as const,
            fetchedAt,
          };
        })
        .filter(Boolean) as DiscoveredModelItem[];

      const result: ModelDiscoveryResult = {
        providerType: this.providerId,
        normalizedBaseUrl: this.baseUrl,
        models,
        source: 'provider-api',
        fetchedAt,
        expiresAt,
        supported: models.length > 0,
        warningCode: models.length === 0 ? 'MODEL_LIST_UNSUPPORTED' : undefined,
        warningMessage:
          models.length === 0
            ? '供应商 /models 返回空列表，请手动填写目标模型 ID。'
            : undefined,
      };

      if (models.length > 0) {
        modelDiscoveryCache.set(configHash, {
          configurationHash: configHash,
          fetchedAt,
          expiresAtMs: now.getTime() + CATALOG_CACHE_TTL_MS,
          result,
        });
      }
      return result;
    } catch (err: any) {
      if (
        err instanceof SecurityError &&
        err.code.startsWith('SSRF_')
      ) {
        throw err;
      }
      return {
        providerType: this.providerId,
        normalizedBaseUrl: this.baseUrl,
        models: [],
        source: 'provider-api',
        fetchedAt,
        expiresAt,
        supported: false,
        warningCode: 'MODEL_LIST_UNSUPPORTED',
        warningMessage: `无法拉取 /models 列表（${String(err?.message || err).slice(0, 90)}）。请手动填写模型 ID 并直接测试连接。`,
      };
    }
  }

  public async generateTextWithTelemetry(
    prompt: string,
    options: GenerateOptions = {}
  ): Promise<{ text: string; telemetry: ProviderCallTelemetry }> {
    if (!this.modelName) {
      throw new SecurityError(
        'MODEL_NOT_FOUND',
        `未指定 ${this.providerId} 的模型 ID，请在设置中选择或手动填写模型 ID`,
        400
      );
    }

    const startMs = Date.now();
    const url = await this.buildEndpointUrl('/chat/completions');

    const messages: Array<{
      role: 'system' | 'user';
      content:
        | string
        | Array<
            | { type: 'text'; text: string }
            | { type: 'image_url'; image_url: { url: string } }
          >;
    }> = [];

    if (options.systemInstruction) {
      messages.push({ role: 'system', content: options.systemInstruction });
    }

    if (options.images && options.images.length > 0) {
      const contentArr: Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      > = [{ type: 'text', text: prompt }];
      for (const img of options.images) {
        contentArr.push({
          type: 'image_url',
          image_url: {
            url: `data:${img.mimeType};base64,${img.base64Data}`,
          },
        });
      }
      messages.push({ role: 'user', content: contentArr });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const bodyPayload: Record<string, unknown> = {
      model: this.modelName,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxOutputTokens ?? 4096,
    };

    if (options.structuredOutputStrategy === 'json_object') {
      bodyPayload.response_format = { type: 'json_object' };
    }

    const res = await safeExternalFetch(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(bodyPayload),
      },
      {
        timeoutMs: options.timeoutMs ?? 30000,
        signal: options.signal,
        dnsLookupFn: this.dnsLookupFn,
      }
    );

    if (res.status === 401 || res.status === 403) {
      throw new SecurityError(
        'PROVIDER_AUTH_FAILED',
        `${this.providerId} 密钥认证失败 (HTTP ${res.status})`,
        401
      );
    }
    if (res.status === 404) {
      throw new SecurityError(
        'MODEL_NOT_FOUND',
        `${this.providerId} 模型或端点不存在 (HTTP 404): ${this.modelName}`,
        404
      );
    }
    if (res.status === 429) {
      throw new SecurityError(
        'PROVIDER_RATE_LIMITED',
        `${this.providerId} 触发速率或配额限制 (HTTP 429)`,
        429
      );
    }
    if (res.status < 200 || res.status >= 300) {
      throw new SecurityError(
        'PROVIDER_UNAVAILABLE',
        `${this.providerId} 响应异常 (HTTP ${res.status}): ${res.bodyText.slice(0, 200)}`,
        502
      );
    }

    const data = JSON.parse(res.bodyText) as {
      id?: string;
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        prompt_cache_hit_tokens?: number;
      };
    };

    const text = data.choices?.[0]?.message?.content || '';
    if (!text.trim()) {
      throw new SecurityError('PROVIDER_UNAVAILABLE', `${this.providerId} 返回空内容`, 502);
    }

    const usage: TokenUsageSummary = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? null,
          completionTokens: data.usage.completion_tokens ?? null,
          cachedTokens: data.usage.prompt_cache_hit_tokens ?? null,
          totalTokens: data.usage.total_tokens ?? null,
          source: 'provider',
        }
      : {
          promptTokens: null,
          completionTokens: null,
          cachedTokens: null,
          totalTokens: null,
          source: 'unknown',
        };

    return {
      text,
      telemetry: {
        usage,
        finishReason: data.choices?.[0]?.finish_reason || 'stop',
        providerRequestId:
          data.id || res.headers.get('x-request-id') || `${this.providerId}-${Date.now()}`,
        latencyMs: Date.now() - startMs,
        retryCount: 0,
      },
    };
  }

  public async generateText(prompt: string, options?: GenerateOptions): Promise<string> {
    const res = await this.generateTextWithTelemetry(prompt, options);
    return res.text;
  }

  public async generateWithImages(
    prompt: string,
    images: MultimodalImageInput[],
    options?: GenerateOptions
  ): Promise<string> {
    const res = await this.generateTextWithTelemetry(prompt, {
      ...options,
      images,
    });
    return res.text;
  }

  public async generateStructuredWithTelemetry<T>(
    prompt: string,
    schemaDescription: string,
    validator: (raw: unknown) => { valid: boolean; errors: string[]; value?: T },
    options: GenerateOptions & { maxRetries?: number } = {}
  ): Promise<{ value: T; telemetry: ProviderCallTelemetry }> {
    const startMs = Date.now();
    const maxRetries = options.maxRetries ?? 2;
    let strategy: StructuredOutputStrategy =
      options.structuredOutputStrategy || 'json_object';

    let currentPrompt = `${prompt}\n\n请严格只输出符合以下 Schema 的 JSON 对象（不要包含任何解释性文字）：\n${schemaDescription}`;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let hasProviderUsage = false;
    let lastFinishReason: string | null = 'stop';
    let lastRequestId: string | null = null;
    let lastErrors: string[] = [];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const { text, telemetry } = await this.generateTextWithTelemetry(currentPrompt, {
          ...options,
          structuredOutputStrategy: strategy,
        });

        if (telemetry.usage.source === 'provider') {
          hasProviderUsage = true;
          totalPromptTokens += telemetry.usage.promptTokens ?? 0;
          totalCompletionTokens += telemetry.usage.completionTokens ?? 0;
        }
        lastFinishReason = telemetry.finishReason;
        lastRequestId = telemetry.providerRequestId;

        const parsed = extractJsonObject(text);
        const check = validator(parsed);
        if (check.valid && check.value !== undefined) {
          return {
            value: check.value,
            telemetry: {
              usage: hasProviderUsage
                ? {
                    promptTokens: totalPromptTokens,
                    completionTokens: totalCompletionTokens,
                    cachedTokens: null,
                    totalTokens: totalPromptTokens + totalCompletionTokens,
                    source: 'provider',
                  }
                : {
                    promptTokens: null,
                    completionTokens: null,
                    cachedTokens: null,
                    totalTokens: null,
                    source: 'unknown',
                  },
              finishReason: lastFinishReason,
              providerRequestId: lastRequestId,
              latencyMs: Date.now() - startMs,
              retryCount: attempt,
              strategyUsed: strategy,
            },
          };
        }
        lastErrors = check.errors;
      } catch (err: any) {
        if (
          err instanceof SecurityError &&
          (err.code === 'PROVIDER_AUTH_FAILED' ||
            err.code === 'PROVIDER_RATE_LIMITED' ||
            err.code === 'PROVIDER_TIMEOUT' ||
            err.code === 'REQUEST_CANCELLED' ||
            err.code.startsWith('SSRF_'))
        ) {
          throw err;
        }
        // Downgrade from json_object to prompt_only if upstream rejected response_format
        strategy = 'prompt_only';
        lastErrors = [err?.message || String(err)];
      }

      currentPrompt = `${prompt}\n\n【格式修正重试 #${attempt + 1}】上次输出未通过 JSON 校验：${lastErrors.join('；')}\n请只输出纯 JSON 对象：\n${schemaDescription}`;
    }

    throw new SecurityError(
      'STRUCTURED_OUTPUT_INVALID',
      `${this.providerId} 结构化 JSON 校验未通过 (已重试 ${maxRetries} 次): ${lastErrors.join('; ')}`,
      422
    );
  }

  public async generateStructured<T>(
    prompt: string,
    schemaDescription: string,
    validator: (raw: unknown) => { valid: boolean; errors: string[]; value?: T },
    options?: GenerateOptions & { maxRetries?: number }
  ): Promise<T> {
    const res = await this.generateStructuredWithTelemetry(
      prompt,
      schemaDescription,
      validator,
      options
    );
    return res.value;
  }

  public async testConnection(options?: {
    layers?: ('basic' | 'structured' | 'vision' | 'sample')[];
    timeoutMs?: number;
  }): Promise<{
    ok: boolean;
    latencyMs: number;
    message: string;
    multiLayerReport?: MultiLayerTestResponse;
  }> {
    const report = await runMultiLayerCapabilityProbe(this, {
      providerType: this.providerId,
      normalizedBaseUrl: this.baseUrl,
      modelId: this.modelName,
      protocolMode: 'chat-completions',
      apiKeyFingerprint: this.apiKey.slice(-6),
      layers: options?.layers || ['basic', 'structured'],
      timeoutMs: options?.timeoutMs ?? 15000,
    });

    const summaryMsg = report.layers.map((l) => `${l.layer}: ${l.ok ? '通过' : '失败'}`).join(' | ');
    return {
      ok: report.ok,
      latencyMs: report.totalLatencyMs,
      message: report.ok ? `连接与能力验证通过 (${summaryMsg})` : `验证未通过 (${summaryMsg})`,
      multiLayerReport: report,
    };
  }
}

/**
 * Executes the 4-Layer Capability Probe specified in Section 七:
 * - Layer 1 (`basic`): Basic connectivity & authentication check
 * - Layer 2 (`structured`): Structured JSON output & schema validation check
 * - Layer 3 (`vision`): Multimodal image input check (1x1 test PNG)
 * - Layer 4 (`sample`): Minimal Kaoyan grading sample check
 */
export async function runMultiLayerCapabilityProbe(
  provider: ModelProvider,
  params: {
    providerType: ProviderType;
    normalizedBaseUrl: string;
    modelId: string;
    protocolMode: ProtocolMode;
    apiKeyFingerprint?: string;
    layers: ('basic' | 'structured' | 'vision' | 'sample')[];
    timeoutMs?: number;
  }
): Promise<MultiLayerTestResponse> {
  const startTotal = Date.now();
  const testedAt = new Date().toISOString();
  const layersResult: MultiLayerTestLayerResult[] = [];
  const verifiedCapabilities: Partial<ModelCapabilityMatrix> = {};
  const capabilitySources: Partial<Record<keyof ModelCapabilityMatrix, CapabilitySource>> = {};

  const configHash = computeConfigurationHash({
    providerType: params.providerType,
    baseUrl: params.normalizedBaseUrl,
    modelId: params.modelId,
    protocolMode: params.protocolMode,
    credentialFingerprint: params.apiKeyFingerprint,
  });

  // Layer 1: Basic Connectivity
  if (params.layers.includes('basic')) {
    const t0 = Date.now();
    try {
      const txt = await provider.generateText('Reply with the single word: OK', {
        maxOutputTokens: 16,
        timeoutMs: params.timeoutMs ?? 12000,
      });
      verifiedCapabilities.text = true;
      capabilitySources.text = 'verified';
      layersResult.push({
        layer: 'basic',
        ok: true,
        latencyMs: Date.now() - t0,
        message: `基础连通成功 (${txt.trim().slice(0, 24)})`,
      });
    } catch (err: any) {
      verifiedCapabilities.text = false;
      layersResult.push({
        layer: 'basic',
        ok: false,
        latencyMs: Date.now() - t0,
        message: err?.message || '基础对话请求失败',
        errorCode: err instanceof SecurityError ? (err.code as any) : 'PROVIDER_UNAVAILABLE',
      });
      // If basic connectivity failed, abort remaining layers immediately
      return {
        ok: false,
        providerType: params.providerType,
        normalizedBaseUrl: params.normalizedBaseUrl,
        modelId: params.modelId,
        protocolMode: params.protocolMode,
        configurationHash: configHash,
        testedAt,
        totalLatencyMs: Date.now() - startTotal,
        layers: layersResult,
        verifiedCapabilities,
        capabilitySources,
      };
    }
  }

  // Layer 2: Structured Output Verification
  if (params.layers.includes('structured')) {
    const t0 = Date.now();
    try {
      await provider.generateStructured(
        'Return a JSON object with status="ok" and score=10.',
        '{"status": "ok", "score": 10}',
        (raw) => {
          const obj = raw as Record<string, unknown>;
          if (obj && obj.status === 'ok' && typeof obj.score === 'number') {
            return { valid: true, errors: [], value: obj };
          }
          return { valid: false, errors: ['Missing status="ok" or numeric score'] };
        },
        { maxRetries: 0, timeoutMs: params.timeoutMs ?? 15000 }
      );
      verifiedCapabilities.structuredOutput = true;
      verifiedCapabilities.jsonObject = true;
      capabilitySources.structuredOutput = 'verified';
      layersResult.push({
        layer: 'structured',
        ok: true,
        latencyMs: Date.now() - t0,
        message: '结构化 JSON 输出与字段类型校验通过',
      });
    } catch (err: any) {
      verifiedCapabilities.structuredOutput = false;
      layersResult.push({
        layer: 'structured',
        ok: false,
        latencyMs: Date.now() - t0,
        message: err?.message || '结构化 JSON 校验未通过',
        errorCode: 'STRUCTURED_OUTPUT_UNSUPPORTED',
      });
    }
  }

  // Layer 3: Vision Multimodal Verification
  if (params.layers.includes('vision')) {
    const t0 = Date.now();
    try {
      const reply = await provider.generateWithImages(
        'Describe this 1x1 test image in one word.',
        [{ mimeType: 'image/png', base64Data: TINY_PROBE_PNG_BASE64 }],
        { maxOutputTokens: 20, timeoutMs: params.timeoutMs ?? 18000 }
      );
      verifiedCapabilities.vision = true;
      capabilitySources.vision = 'verified';
      layersResult.push({
        layer: 'vision',
        ok: true,
        latencyMs: Date.now() - t0,
        message: `多模态图像输入探测通过 (${reply.trim().slice(0, 24)})`,
      });
    } catch (err: any) {
      verifiedCapabilities.vision = false;
      capabilitySources.vision = 'verified';
      layersResult.push({
        layer: 'vision',
        ok: false,
        latencyMs: Date.now() - t0,
        message: `该模型不支持多模态图片输入 (${String(err?.message || err).slice(0, 60)})`,
        errorCode: 'VISION_NOT_SUPPORTED',
      });
    }
  }

  // Layer 4: Minimal Sample Grading Probe
  if (params.layers.includes('sample')) {
    const t0 = Date.now();
    try {
      await provider.generateStructured(
        'Evaluate student translation "知识就是力量" for "Knowledge is power" (maxScore 2). Return JSON {"score": 2, "comment": "准确"}.',
        '{"score": number, "comment": string}',
        (raw) => {
          const obj = raw as Record<string, unknown>;
          if (obj && typeof obj.score === 'number' && typeof obj.comment === 'string') {
            return { valid: true, errors: [], value: obj };
          }
          return { valid: false, errors: ['Invalid sample grading output'] };
        },
        { maxRetries: 0, timeoutMs: params.timeoutMs ?? 15000 }
      );
      layersResult.push({
        layer: 'sample',
        ok: true,
        latencyMs: Date.now() - t0,
        message: '最小批改样例探测通过',
      });
    } catch (err: any) {
      layersResult.push({
        layer: 'sample',
        ok: false,
        latencyMs: Date.now() - t0,
        message: err?.message || '最小批改样例探测失败',
        errorCode: 'STRUCTURED_OUTPUT_INVALID',
      });
    }
  }

  const basicOk = layersResult.find((l) => l.layer === 'basic')?.ok ?? true;
  const structuredLayer = layersResult.find((l) => l.layer === 'structured');
  const overallOk = basicOk && (structuredLayer ? structuredLayer.ok : true);

  return {
    ok: overallOk,
    providerType: params.providerType,
    normalizedBaseUrl: params.normalizedBaseUrl,
    modelId: params.modelId,
    protocolMode: params.protocolMode,
    configurationHash: configHash,
    testedAt,
    totalLatencyMs: Date.now() - startTotal,
    layers: layersResult,
    verifiedCapabilities,
    capabilitySources,
  };
}

export function createModelProvider(options: {
  provider: ProviderType;
  apiKey: string;
  modelName?: string;
  baseUrl?: string;
  verifiedCapabilities?: Partial<ModelCapabilityMatrix>;
  capabilitySource?: CapabilitySource;
  dnsLookupFn?: (hostname: string) => Promise<{ address: string }[]>;
}): ModelProvider {
  if (options.provider === 'gemini') {
    return new GeminiModelProvider({
      apiKey: options.apiKey,
      modelName: options.modelName,
      baseUrl: options.baseUrl,
      verifiedCapabilities: options.verifiedCapabilities,
      capabilitySource: options.capabilitySource,
    });
  }
  return new OpenAICompatibleModelProvider({
    providerId: options.provider,
    apiKey: options.apiKey,
    modelName: options.modelName,
    baseUrl: options.baseUrl,
    verifiedCapabilities: options.verifiedCapabilities,
    capabilitySource: options.capabilitySource,
    dnsLookupFn: options.dnsLookupFn,
  });
}
