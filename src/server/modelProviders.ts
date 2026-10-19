import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import type { ModelCapabilities } from '../shared/types.ts';
import {
  SecurityError,
  safeExternalFetch,
  validateSafeCustomBaseUrl,
} from './securityAndCrypto.ts';

export interface ImageInputPart {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  base64Data: string;
}

export interface GenerateTextParams {
  systemInstruction?: string;
  prompt: string;
  temperature?: number;
}

export interface GenerateStructuredParams<T> {
  systemInstruction?: string;
  prompt: string;
  responseSchema?: Record<string, unknown>;
  validateFn?: (parsed: unknown) => { valid: boolean; errors: string[]; value?: T };
  maxRetries?: number;
}

export interface GenerateWithImagesParams {
  systemInstruction?: string;
  prompt: string;
  images: ImageInputPart[];
  requireJson?: boolean;
}

export interface ModelProvider {
  readonly providerId: 'gemini' | 'deepseek' | 'openai-compatible';
  readonly modelName: string;
  getCapabilities(): ModelCapabilities;
  testConnection(): Promise<{ ok: boolean; latencyMs: number; message: string }>;
  generateText(params: GenerateTextParams): Promise<string>;
  generateStructured<T = Record<string, unknown>>(params: GenerateStructuredParams<T>): Promise<T>;
  generateWithImages(params: GenerateWithImagesParams): Promise<string>;
}

/**
 * GeminiProvider using official @google/genai SDK on the server side.
 */
export class GeminiProvider implements ModelProvider {
  public readonly providerId = 'gemini' as const;
  public readonly modelName: string;
  private readonly apiKey: string;

  constructor(apiKey: string, modelName?: string) {
    this.apiKey = apiKey;
    this.modelName = modelName || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  }

  private getClient(): GoogleGenAI {
    if (!this.apiKey || this.apiKey === 'MY_GEMINI_API_KEY') {
      throw new SecurityError('MODEL_KEY_MISSING', '未配置有效的 Gemini API Key', 503);
    }
    return new GoogleGenAI({
      apiKey: this.apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  getCapabilities(): ModelCapabilities {
    return {
      provider: 'gemini',
      displayName: 'Google Gemini',
      defaultModel: this.modelName,
      supportsVision: true,
      supportsJsonObject: true,
      supportsJsonSchema: true,
      supportsStreaming: true,
      supportsReasoning: true,
      maxInput: 1048576,
      maxOutput: 65536,
    };
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number; message: string }> {
    const start = Date.now();
    const ai = this.getClient();
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: this.modelName,
      contents: 'Reply with the single word: READY',
    });
    const text = response.text || '';
    return {
      ok: text.trim().length > 0,
      latencyMs: Date.now() - start,
      message: `Gemini (${this.modelName}) 连接正常`,
    };
  }

  async generateText(params: GenerateTextParams): Promise<string> {
    const ai = this.getClient();
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: this.modelName,
      contents: params.prompt,
      config: {
        systemInstruction: params.systemInstruction,
        temperature: params.temperature ?? 0.3,
      },
    });
    return response.text || '';
  }

  async generateStructured<T = Record<string, unknown>>(
    params: GenerateStructuredParams<T>
  ): Promise<T> {
    const ai = this.getClient();
    const maxRetries = params.maxRetries ?? 2;
    let lastErrors: string[] = [];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const retryPrompt =
        attempt === 0
          ? params.prompt
          : `${params.prompt}\n\n[重试修正要求] 上一次输出未通过结构或引用校验：${lastErrors.join(
              '; '
            )}。请严格输出合法JSON并确保所有批注引用与原文完全一致。`;

      const response: GenerateContentResponse = await ai.models.generateContent({
        model: this.modelName,
        contents: retryPrompt,
        config: {
          systemInstruction: params.systemInstruction,
          responseMimeType: 'application/json',
          ...(params.responseSchema ? { responseSchema: params.responseSchema as any } : {}),
          temperature: 0.2,
        },
      });

      const rawText = (response.text || '').trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(stripMarkdownCodeFence(rawText));
      } catch {
        lastErrors = ['模型输出不是合法的 JSON 字符串'];
        continue;
      }

      if (params.validateFn) {
        const check = params.validateFn(parsed);
        if (!check.valid) {
          lastErrors = check.errors;
          continue;
        }
        return (check.value ?? parsed) as T;
      }

      return parsed as T;
    }

    throw new SecurityError(
      'INVALID_MODEL_JSON_OUTPUT',
      `模型结构化输出校验失败: ${lastErrors.join('；')}`,
      422
    );
  }

  async generateWithImages(params: GenerateWithImagesParams): Promise<string> {
    if (!params.images || params.images.length === 0) {
      throw new SecurityError('VISION_IMAGE_REQUIRED', '视觉分析任务缺少图片输入', 400);
    }
    const ai = this.getClient();
    const parts: any[] = params.images.map((img) => ({
      inlineData: {
        mimeType: img.mimeType,
        data: img.base64Data,
      },
    }));
    parts.push({ text: params.prompt });

    const response: GenerateContentResponse = await ai.models.generateContent({
      model: this.modelName,
      contents: { parts },
      config: {
        systemInstruction: params.systemInstruction,
        ...(params.requireJson ? { responseMimeType: 'application/json' } : {}),
      },
    });
    return response.text || '';
  }
}

/**
 * DeepSeekProvider (supports text, JSON object, and reasoning; explicitly blocks vision tasks unless switched to a vision model).
 */
export class DeepSeekProvider implements ModelProvider {
  public readonly providerId = 'deepseek' as const;
  public readonly modelName: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, modelName?: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.modelName = modelName || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    this.baseUrl = (baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  }

  getCapabilities(): ModelCapabilities {
    const supportsVision = this.modelName.toLowerCase().includes('vl');
    return {
      provider: 'deepseek',
      displayName: 'DeepSeek',
      defaultModel: this.modelName,
      supportsVision,
      supportsJsonObject: true,
      supportsJsonSchema: false,
      supportsStreaming: true,
      supportsReasoning: true,
      maxInput: 65536,
      maxOutput: 8192,
    };
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number; message: string }> {
    const start = Date.now();
    const reply = await this.generateText({
      prompt: 'Reply with the single word: READY',
    });
    return {
      ok: reply.trim().length > 0,
      latencyMs: Date.now() - start,
      message: `DeepSeek (${this.modelName}) 连接正常`,
    };
  }

  async generateText(params: GenerateTextParams): Promise<string> {
    if (!this.apiKey) {
      throw new SecurityError('MODEL_KEY_MISSING', '未配置 DeepSeek API Key', 503);
    }
    const endpoint = `${this.baseUrl}/chat/completions`;
    const res = await safeExternalFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        messages: [
          ...(params.systemInstruction
            ? [{ role: 'system', content: params.systemInstruction }]
            : []),
          { role: 'user', content: params.prompt },
        ],
        temperature: params.temperature ?? 0.3,
      }),
    });

    if (res.status < 200 || res.status >= 300) {
      throw new SecurityError(
        'UPSTREAM_MODEL_ERROR',
        `DeepSeek 接口返回状态码 ${res.status}`,
        502
      );
    }
    const data = JSON.parse(res.bodyText);
    return data?.choices?.[0]?.message?.content || '';
  }

  async generateStructured<T = Record<string, unknown>>(
    params: GenerateStructuredParams<T>
  ): Promise<T> {
    if (!this.apiKey) {
      throw new SecurityError('MODEL_KEY_MISSING', '未配置 DeepSeek API Key', 503);
    }
    const maxRetries = params.maxRetries ?? 2;
    let lastErrors: string[] = [];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const endpoint = `${this.baseUrl}/chat/completions`;
      const res = await safeExternalFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelName,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `${
                params.systemInstruction || ''
              }\n请严格只输出合法的 JSON 对象，不要包含额外解释。`,
            },
            {
              role: 'user',
              content:
                attempt === 0
                  ? params.prompt
                  : `${params.prompt}\n修正错误: ${lastErrors.join('；')}`,
            },
          ],
          temperature: 0.2,
        }),
      });

      if (res.status < 200 || res.status >= 300) {
        throw new SecurityError(
          'UPSTREAM_MODEL_ERROR',
          `DeepSeek 接口返回状态码 ${res.status}`,
          502
        );
      }

      let parsed: unknown;
      try {
        const outer = JSON.parse(res.bodyText);
        const content = outer?.choices?.[0]?.message?.content || '';
        parsed = JSON.parse(stripMarkdownCodeFence(content));
      } catch {
        lastErrors = ['模型输出不是合法的 JSON 对象'];
        continue;
      }

      if (params.validateFn) {
        const check = params.validateFn(parsed);
        if (!check.valid) {
          lastErrors = check.errors;
          continue;
        }
        return (check.value ?? parsed) as T;
      }
      return parsed as T;
    }

    throw new SecurityError(
      'INVALID_MODEL_JSON_OUTPUT',
      `DeepSeek 结构化输出校验失败: ${lastErrors.join('；')}`,
      422
    );
  }

  async generateWithImages(_params: GenerateWithImagesParams): Promise<string> {
    if (!this.getCapabilities().supportsVision) {
      throw new SecurityError(
        'PROVIDER_VISION_UNSUPPORTED',
        `当前选择的模型 (${this.modelName}) 不支持图片视觉理解。请切换到支持视觉的模型（如 Gemini）后再执行看图任务，系统禁止忽略图片继续分析。`,
        422
      );
    }
    throw new SecurityError('PROVIDER_VISION_UNSUPPORTED', '当前 DeepSeek 模型不支持图片输入', 422);
  }
}

/**
 * OpenAICompatibleProvider with full SSRF validation on custom Base URL.
 */
export class OpenAICompatibleProvider implements ModelProvider {
  public readonly providerId = 'openai-compatible' as const;
  public readonly modelName: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly supportsVisionFlag: boolean;

  constructor(
    apiKey: string,
    baseUrl?: string,
    modelName?: string,
    supportsVisionFlag?: boolean
  ) {
    this.apiKey = apiKey;
    this.baseUrl = (
      baseUrl ||
      process.env.CUSTOM_OPENAI_BASE_URL ||
      'https://api.openai.com/v1'
    ).replace(/\/+$/, '');
    this.modelName = modelName || process.env.CUSTOM_OPENAI_MODEL || 'gpt-4o-mini';
    this.supportsVisionFlag =
      supportsVisionFlag ??
      (/gpt-4o|vision|vl|claude-3|gemini/i.test(this.modelName));
  }

  getCapabilities(): ModelCapabilities {
    return {
      provider: 'openai-compatible',
      displayName: 'OpenAI 兼容接口',
      defaultModel: this.modelName,
      supportsVision: this.supportsVisionFlag,
      supportsJsonObject: true,
      supportsJsonSchema: true,
      supportsStreaming: true,
      supportsReasoning: false,
      maxInput: 128000,
      maxOutput: 16384,
    };
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number; message: string }> {
    const start = Date.now();
    await validateSafeCustomBaseUrl(this.baseUrl);
    const reply = await this.generateText({
      prompt: 'Reply with the single word: READY',
    });
    return {
      ok: reply.trim().length > 0,
      latencyMs: Date.now() - start,
      message: `OpenAI 兼容接口 (${this.modelName}) 连接正常`,
    };
  }

  async generateText(params: GenerateTextParams): Promise<string> {
    if (!this.apiKey) {
      throw new SecurityError('MODEL_KEY_MISSING', '未配置自定义 OpenAI 兼容 API Key', 503);
    }
    const safeBase = await validateSafeCustomBaseUrl(this.baseUrl);
    const res = await safeExternalFetch(`${safeBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        messages: [
          ...(params.systemInstruction
            ? [{ role: 'system', content: params.systemInstruction }]
            : []),
          { role: 'user', content: params.prompt },
        ],
        temperature: params.temperature ?? 0.3,
      }),
    });

    if (res.status < 200 || res.status >= 300) {
      throw new SecurityError(
        'UPSTREAM_MODEL_ERROR',
        `OpenAI 兼容接口返回状态码 ${res.status}`,
        502
      );
    }
    const parsed = JSON.parse(res.bodyText);
    return parsed?.choices?.[0]?.message?.content || '';
  }

  async generateStructured<T = Record<string, unknown>>(
    params: GenerateStructuredParams<T>
  ): Promise<T> {
    if (!this.apiKey) {
      throw new SecurityError('MODEL_KEY_MISSING', '未配置自定义 OpenAI 兼容 API Key', 503);
    }
    const safeBase = await validateSafeCustomBaseUrl(this.baseUrl);
    const maxRetries = params.maxRetries ?? 2;
    let lastErrors: string[] = [];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await safeExternalFetch(`${safeBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelName,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `${params.systemInstruction || ''}\n请只输出合法的 JSON 对象。`,
            },
            {
              role: 'user',
              content:
                attempt === 0
                  ? params.prompt
                  : `${params.prompt}\n修正错误: ${lastErrors.join('；')}`,
            },
          ],
          temperature: 0.2,
        }),
      });

      if (res.status < 200 || res.status >= 300) {
        throw new SecurityError(
          'UPSTREAM_MODEL_ERROR',
          `OpenAI 兼容接口返回状态码 ${res.status}`,
          502
        );
      }

      let parsed: unknown;
      try {
        const outer = JSON.parse(res.bodyText);
        const content = outer?.choices?.[0]?.message?.content || '';
        parsed = JSON.parse(stripMarkdownCodeFence(content));
      } catch {
        lastErrors = ['模型输出不是合法的 JSON'];
        continue;
      }

      if (params.validateFn) {
        const check = params.validateFn(parsed);
        if (!check.valid) {
          lastErrors = check.errors;
          continue;
        }
        return (check.value ?? parsed) as T;
      }
      return parsed as T;
    }

    throw new SecurityError(
      'INVALID_MODEL_JSON_OUTPUT',
      `OpenAI 兼容接口结构化输出校验失败: ${lastErrors.join('；')}`,
      422
    );
  }

  async generateWithImages(params: GenerateWithImagesParams): Promise<string> {
    if (!this.getCapabilities().supportsVision) {
      throw new SecurityError(
        'PROVIDER_VISION_UNSUPPORTED',
        `当前选择的模型 (${this.modelName}) 不支持图片视觉理解。请切换到支持视觉的模型（如 Gemini 或 GPT-4o）后再执行看图任务，禁止忽略图片继续分析。`,
        422
      );
    }
    const safeBase = await validateSafeCustomBaseUrl(this.baseUrl);
    const contentParts: any[] = params.images.map((img) => ({
      type: 'image_url',
      image_url: {
        url: `data:${img.mimeType};base64,${img.base64Data}`,
      },
    }));
    contentParts.push({ type: 'text', text: params.prompt });

    const res = await safeExternalFetch(`${safeBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        messages: [
          ...(params.systemInstruction
            ? [{ role: 'system', content: params.systemInstruction }]
            : []),
          { role: 'user', content: contentParts },
        ],
      }),
    });

    if (res.status < 200 || res.status >= 300) {
      throw new SecurityError(
        'UPSTREAM_MODEL_ERROR',
        `OpenAI 兼容视觉接口返回状态码 ${res.status}`,
        502
      );
    }
    const parsed = JSON.parse(res.bodyText);
    return parsed?.choices?.[0]?.message?.content || '';
  }
}

export function stripMarkdownCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}
