import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { AIErrorCode, ProtocolMode, ProviderType } from '../shared/types.ts';

export interface EncryptedCredentialRecord {
  connectionId?: string;
  provider: ProviderType;
  ciphertext: string;
  iv: string;
  authTag: string;
  encryptionVersion: number;
  maskedKey: string;
  model: string;
  baseUrl?: string;
  protocolMode?: ProtocolMode;
  configurationHash?: string;
  lastTestedAt: string | null;
  lastTestStatus: 'success' | 'failed' | 'untested' | 'invalidated';
  updatedAt: string;
}

export class SecurityError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(code: string, message: string, status: number = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Ephemeral or local-instance random 32-byte key (never a hardcoded/public string)
let cachedAutoMasterKey: Buffer | null = null;
let loggedMissingProdKeyWarning = false;

function getOrCreateAutoMasterKey(): Buffer {
  if (cachedAutoMasterKey) {
    return cachedAutoMasterKey;
  }
  const candidatePaths = [
    path.join(process.cwd(), 'data', 'runtime', '.master.key'),
    '/tmp/.yanjuan-master.key',
  ];
  for (const keyPath of candidatePaths) {
    try {
      if (fs.existsSync(keyPath)) {
        const raw = fs.readFileSync(keyPath, 'utf8').trim();
        if (/^[0-9a-fA-F]{64}$/.test(raw)) {
          cachedAutoMasterKey = Buffer.from(raw, 'hex');
          return cachedAutoMasterKey;
        }
      }
      fs.mkdirSync(path.dirname(keyPath), { recursive: true });
      const generated = crypto.randomBytes(32);
      fs.writeFileSync(keyPath, generated.toString('hex'), { encoding: 'utf8', mode: 0o600 });
      cachedAutoMasterKey = generated;
      return cachedAutoMasterKey;
    } catch {
      // Try next writable location
    }
  }
  cachedAutoMasterKey = crypto.randomBytes(32);
  return cachedAutoMasterKey;
}

export interface KeyRingConfig {
  currentVersion: number;
  keys: Record<number, string>;
}

function parseRawKeyToBuffer(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  const b64 = Buffer.from(trimmed, 'base64');
  if (b64.byteLength === 32 && b64.toString('base64') === trimmed) {
    return b64;
  }
  return crypto.createHash('sha256').update(trimmed, 'utf8').digest();
}

/**
 * Verifies at startup or runtime whether an explicit master encryption key is configured.
 * - Never falls back to any public fixed string.
 * - In Cloud Run / AI Studio deployments where CREDENTIAL_ENCRYPTION_KEY is not pre-configured,
 *   automatically initializes a cryptographically random 32-byte instance key unless STRICT_PRODUCTION_KEY_CHECK=true.
 */
export function assertProductionMasterKeyConfigured(
  env: NodeJS.ProcessEnv = process.env
): void {
  const isProd = env.NODE_ENV === 'production';
  const rawKey = env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  const rawRing = env.CREDENTIAL_ENCRYPTION_KEY_RING_JSON?.trim();

  if (isProd && !rawKey && !rawRing) {
    if (env.STRICT_PRODUCTION_KEY_CHECK === 'true') {
      throw new SecurityError(
        'INTERNAL_CONFIGURATION_ERROR',
        '生产环境缺少 CREDENTIAL_ENCRYPTION_KEY 主加密密钥，拒绝启动以确保凭证安全',
        500
      );
    }
    getOrCreateAutoMasterKey();
    if (!loggedMissingProdKeyWarning) {
      loggedMissingProdKeyWarning = true;
      console.warn(
        '[security] CREDENTIAL_ENCRYPTION_KEY 未显式配置，已自动生成实例级 256-bit 随机主密钥（建议在生产环境变量中配置固定随机密钥以支持多实例共享）'
      );
    }
  }
}

/**
 * Resolves the encryption key for a given keyVersion.
 * Supports key rotation via CREDENTIAL_ENCRYPTION_KEY_RING_JSON or explicit keyRingOverride.
 */
export function getMasterEncryptionKey(options?: {
  explicitSecret?: string;
  keyVersion?: number;
  keyRingOverride?: Record<number, string>;
  env?: NodeJS.ProcessEnv;
}): { key: Buffer; version: number } {
  const env = options?.env || process.env;
  const requestedVersion = options?.keyVersion;

  if (options?.keyRingOverride) {
    const versions = Object.keys(options.keyRingOverride)
      .map(Number)
      .sort((a, b) => b - a);
    const ver = requestedVersion ?? versions[0] ?? 1;
    const secret = options.keyRingOverride[ver];
    if (!secret) {
      throw new SecurityError(
        'CREDENTIAL_DECRYPTION_FAILED',
        `未找到版本 v${ver} 对应的主加密密钥`,
        403
      );
    }
    return { key: parseRawKeyToBuffer(secret), version: ver };
  }

  if (options?.explicitSecret) {
    return {
      key: parseRawKeyToBuffer(options.explicitSecret),
      version: requestedVersion ?? 1,
    };
  }

  if (env.CREDENTIAL_ENCRYPTION_KEY_RING_JSON) {
    try {
      const parsed = JSON.parse(env.CREDENTIAL_ENCRYPTION_KEY_RING_JSON) as KeyRingConfig;
      const ver = requestedVersion ?? parsed.currentVersion ?? 1;
      const rawSecret = parsed.keys?.[ver];
      if (!rawSecret) {
        throw new Error(`Missing key version ${ver}`);
      }
      return { key: parseRawKeyToBuffer(rawSecret), version: ver };
    } catch (err: any) {
      if (err instanceof SecurityError) throw err;
      throw new SecurityError(
        'INTERNAL_CONFIGURATION_ERROR',
        'CREDENTIAL_ENCRYPTION_KEY_RING_JSON 格式无效或缺少目标密钥版本',
        500
      );
    }
  }

  assertProductionMasterKeyConfigured(env);

  if (env.CREDENTIAL_ENCRYPTION_KEY?.trim()) {
    const ver = Number(env.CREDENTIAL_ENCRYPTION_KEY_VERSION) || requestedVersion || 1;
    return {
      key: parseRawKeyToBuffer(env.CREDENTIAL_ENCRYPTION_KEY),
      version: ver,
    };
  }

  // Use persisted or process-local cryptographically random 32-byte key (never a fixed string)
  return {
    key: getOrCreateAutoMasterKey(),
    version: requestedVersion ?? 1,
  };
}

/**
 * Computes a deterministic hash of connection + model + protocol configuration.
 * Any change to providerType, baseUrl, modelId, protocolMode, or credential invalidates prior test results.
 */
export function computeConfigurationHash(params: {
  connectionId?: string;
  providerType: ProviderType;
  baseUrl?: string;
  modelId?: string;
  protocolMode?: ProtocolMode;
  credentialFingerprint?: string;
}): string {
  const normalizedBase = normalizeProviderBaseUrl(params.providerType, params.baseUrl);
  const payload = JSON.stringify({
    providerType: params.providerType,
    baseUrl: normalizedBase,
    modelId: (params.modelId || '').trim(),
    protocolMode: params.protocolMode || (params.providerType === 'gemini' ? 'gemini-native' : 'chat-completions'),
    credentialFingerprint: params.credentialFingerprint || '',
  });
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Encrypts a user API key using AES-256-GCM with random 12-byte IV and (uid + provider + version) as AAD.
 */
export function encryptProviderApiKey(
  uid: string,
  provider: ProviderType,
  plainApiKey: string,
  options: {
    connectionId?: string;
    model: string;
    baseUrl?: string;
    protocolMode?: ProtocolMode;
    secretOverride?: string;
    keyVersion?: number;
    keyRingOverride?: Record<number, string>;
    env?: NodeJS.ProcessEnv;
  }
): EncryptedCredentialRecord {
  if (!uid || !plainApiKey || plainApiKey.trim().length < 6) {
    throw new SecurityError('INVALID_API_KEY', 'API Key 长度或格式无效', 400);
  }
  const cleanKey = plainApiKey.trim();
  const { key, version } = getMasterEncryptionKey({
    explicitSecret: options.secretOverride,
    keyVersion: options.keyVersion,
    keyRingOverride: options.keyRingOverride,
    env: options.env,
  });
  const iv = crypto.randomBytes(12);
  const aad = Buffer.from(`${uid}:${provider}:v${version}`, 'utf8');

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([
    cipher.update(cleanKey, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const masked = maskApiKey(cleanKey);
  const keyFp = crypto.createHash('sha256').update(cleanKey, 'utf8').digest('hex').slice(0, 12);

  return {
    connectionId: options.connectionId,
    provider,
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    encryptionVersion: version,
    maskedKey: masked,
    model: options.model,
    baseUrl: options.baseUrl,
    protocolMode: options.protocolMode,
    configurationHash: computeConfigurationHash({
      connectionId: options.connectionId,
      providerType: provider,
      baseUrl: options.baseUrl,
      modelId: options.model,
      protocolMode: options.protocolMode,
      credentialFingerprint: keyFp,
    }),
    lastTestedAt: null,
    lastTestStatus: 'untested',
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Decrypts an AES-256-GCM encrypted API key on the server.
 * Fails immediately if uid, provider, or keyVersion AAD does not match.
 */
export function decryptProviderApiKey(
  uid: string,
  provider: ProviderType,
  record: Pick<EncryptedCredentialRecord, 'ciphertext' | 'iv' | 'authTag' | 'encryptionVersion'>,
  secretOverride?: string,
  keyRingOverride?: Record<number, string>,
  env?: NodeJS.ProcessEnv
): string {
  const { key } = getMasterEncryptionKey({
    explicitSecret: secretOverride,
    keyVersion: record.encryptionVersion,
    keyRingOverride,
    env,
  });
  const iv = Buffer.from(record.iv, 'base64');
  const authTag = Buffer.from(record.authTag, 'base64');
  const ciphertext = Buffer.from(record.ciphertext, 'base64');
  const aad = Buffer.from(`${uid}:${provider}:v${record.encryptionVersion}`, 'utf8');

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    throw new SecurityError(
      'CREDENTIAL_DECRYPTION_FAILED',
      '密钥解密校验失败或身份上下文不匹配',
      403
    );
  }
}

/**
 * Rotates an existing EncryptedCredentialRecord from an old keyVersion to a new keyVersion
 * without exposing plaintext outside the rotation boundary.
 */
export function rotateCredentialEncryptionKey(
  uid: string,
  record: EncryptedCredentialRecord,
  keyRing: Record<number, string>,
  targetVersion: number
): EncryptedCredentialRecord {
  const plain = decryptProviderApiKey(
    uid,
    record.provider,
    record,
    undefined,
    keyRing
  );
  const rotated = encryptProviderApiKey(uid, record.provider, plain, {
    connectionId: record.connectionId,
    model: record.model,
    baseUrl: record.baseUrl,
    protocolMode: record.protocolMode,
    keyVersion: targetVersion,
    keyRingOverride: keyRing,
  });
  return {
    ...rotated,
    lastTestedAt: record.lastTestedAt,
    lastTestStatus: record.lastTestStatus,
  };
}

/**
 * Masks an API key so only prefix and last 4 characters are visible.
 */
export function maskApiKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (trimmed.length <= 8) {
    return '****' + trimmed.slice(-2);
  }
  const prefix = trimmed.slice(0, 3);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••••••${suffix}`;
}

/**
 * Normalizes a provider Base URL so that:
 * - Trailing slashes are stripped
 * - Accidental duplicate `/v1/v1` or trailing `/chat/completions` or `/models` are normalized to `/v1`
 *   for OpenAI-compatible and DeepSeek endpoints, preventing `/v1/v1/models` errors.
 */
export function normalizeProviderBaseUrl(
  providerType: ProviderType,
  rawBaseUrl?: string
): string {
  if (providerType === 'gemini' && !rawBaseUrl) {
    return 'https://generativelanguage.googleapis.com';
  }
  const defaultUrl =
    providerType === 'deepseek'
      ? 'https://api.deepseek.com/v1'
      : 'https://api.openai.com/v1';

  const input = (rawBaseUrl || defaultUrl).trim();
  if (!input) return defaultUrl;

  let cleaned = input
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/models$/i, '')
    .replace(/(\/v1)+$/i, '/v1');

  if (providerType !== 'gemini') {
    try {
      const parsed = new URL(cleaned);
      if (parsed.pathname === '' || parsed.pathname === '/') {
        parsed.pathname = '/v1';
        cleaned = parsed.toString().replace(/\/+$/, '');
      }
    } catch {
      // Let validateSafeCustomBaseUrl catch invalid URL syntax later
    }
  }

  return cleaned;
}

/**
 * Checks if an IPv4 or IPv6 address belongs to loopback, private, link-local,
 * cloud metadata, or unspecified ranges.
 */
export function isPrivateOrBlockedIp(ip: string): boolean {
  const cleanIp = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');

  if (
    cleanIp === 'localhost' ||
    cleanIp === '0.0.0.0' ||
    cleanIp === '::1' ||
    cleanIp === '::' ||
    cleanIp === '0:0:0:0:0:0:0:1' ||
    cleanIp === '0:0:0:0:0:0:0:0'
  ) {
    return true;
  }

  // Handle IPv4-mapped IPv6 addresses ::ffff:127.0.0.1
  if (cleanIp.startsWith('::ffff:')) {
    const mappedV4 = cleanIp.slice('::ffff:'.length);
    if (net.isIPv4(mappedV4)) {
      return isPrivateOrBlockedIp(mappedV4);
    }
  }

  if (net.isIPv4(cleanIp)) {
    const parts = cleanIp.split('.').map(Number);
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // Multicast & reserved
    return false;
  }

  if (net.isIPv6(cleanIp)) {
    if (
      cleanIp.startsWith('fc') ||
      cleanIp.startsWith('fd') || // Unique local fc00::/7
      cleanIp.startsWith('fe8') ||
      cleanIp.startsWith('fe9') ||
      cleanIp.startsWith('fea') ||
      cleanIp.startsWith('feb') || // Link-local fe80::/10
      cleanIp.startsWith('ff') // Multicast
    ) {
      return true;
    }
    return false;
  }

  return true;
}

/**
 * Validates a custom OpenAI-compatible Base URL against SSRF attacks:
 * - Only HTTPS allowed
 * - Rejects localhost, 0.0.0.0, loopback, private subnets, link-local, and cloud metadata domains/IPs
 * - Resolves DNS to block DNS rebinding to internal IPs
 */
export async function validateSafeCustomBaseUrl(
  rawUrl: string,
  dnsLookupFn: (hostname: string) => Promise<{ address: string }[]> = async (host) =>
    dns.lookup(host, { all: true })
): Promise<string> {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new SecurityError('INVALID_BASE_URL', '自定义 Base URL 不能为空', 400);
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new SecurityError('INVALID_BASE_URL', `无效的 URL 格式: ${rawUrl}`, 400);
  }

  if (parsed.protocol !== 'https:') {
    throw new SecurityError(
      'SSRF_NON_HTTPS_FORBIDDEN',
      `自定义 Base URL 只允许使用 HTTPS 协议，拒绝: ${parsed.protocol}`,
      400
    );
  }

  if (parsed.username || parsed.password) {
    throw new SecurityError(
      'UNSAFE_BASE_URL',
      '禁止在 Base URL 中内嵌用户名或密码',
      400
    );
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const blockedHostnames = new Set([
    'localhost',
    'localhost.localdomain',
    'metadata.google.internal',
    'metadata',
    'instance-data',
    '0.0.0.0',
  ]);

  if (
    blockedHostnames.has(hostname) ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.localhost')
  ) {
    throw new SecurityError(
      'SSRF_BLOCKED_HOST',
      `禁止访问内网、本地或云元数据主机名: ${hostname}`,
      400
    );
  }

  if (net.isIP(hostname) !== 0) {
    if (isPrivateOrBlockedIp(hostname)) {
      throw new SecurityError(
        'SSRF_PRIVATE_IP_FORBIDDEN',
        `禁止访问私有网段、回环或链路本地 IP 地址: ${hostname}`,
        400
      );
    }
    return parsed.toString().replace(/\/+$/, '');
  }

  // Resolve DNS records and verify all resolved IPs are public
  let records: { address: string }[];
  try {
    records = await dnsLookupFn(hostname);
  } catch {
    throw new SecurityError(
      'SSRF_DNS_RESOLUTION_FAILED',
      `无法解析自定义 Base URL 主机名: ${hostname}`,
      400
    );
  }

  if (!records || records.length === 0) {
    throw new SecurityError('SSRF_DNS_RESOLUTION_FAILED', `DNS 解析结果为空: ${hostname}`, 400);
  }

  for (const rec of records) {
    if (isPrivateOrBlockedIp(rec.address)) {
      throw new SecurityError(
        'SSRF_DNS_REBIND_BLOCKED',
        `主机名 ${hostname} 解析到了受禁内网或保留地址 (${rec.address})`,
        400
      );
    }
  }

  return parsed.toString().replace(/\/+$/, '');
}

/**
 * Validates and loads an exam illustration image strictly from `public/assets/papers/`.
 * Prevents arbitrary file read / path traversal attacks and verifies PNG/JPEG/WebP magic bytes.
 */
export function loadVerifiedExamImageAsset(
  rootDir: string,
  assetPath: string
): {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  base64Data: string;
  sha256: string;
  byteLength: number;
  relativePath: string;
} {
  if (!assetPath || typeof assetPath !== 'string') {
    throw new SecurityError('VISION_NOT_SUPPORTED', '缺少图片资源路径', 400);
  }
  const cleanRel = assetPath.trim().replace(/^\/+/, '');
  if (cleanRel.includes('..') || cleanRel.includes('\0') || !cleanRel.startsWith('assets/papers/')) {
    throw new SecurityError(
      'UNSAFE_ASSET_PATH',
      `禁止读取受控题库插图目录以外的文件: ${assetPath}`,
      403
    );
  }

  const allowedRoot = path.resolve(rootDir, 'public', 'assets', 'papers');
  const resolvedFile = path.resolve(rootDir, 'public', cleanRel);
  if (!resolvedFile.startsWith(allowedRoot + path.sep)) {
    throw new SecurityError(
      'UNSAFE_ASSET_PATH',
      `图片路径越界拦截: ${assetPath}`,
      403
    );
  }

  if (!fs.existsSync(resolvedFile)) {
    throw new SecurityError(
      'ASSET_NOT_FOUND',
      `未找到真题插图文件: ${cleanRel}`,
      404
    );
  }

  const stat = fs.statSync(resolvedFile);
  if (!stat.isFile() || stat.size === 0 || stat.size > 5 * 1024 * 1024) {
    throw new SecurityError(
      'ASSET_SIZE_INVALID',
      `真题插图大小异常 (${stat.size} bytes)`,
      422
    );
  }

  const buf = fs.readFileSync(resolvedFile);
  let mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | null = null;
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    mimeType = 'image/png';
  } else if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    mimeType = 'image/jpeg';
  } else if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    mimeType = 'image/webp';
  }

  if (!mimeType) {
    throw new SecurityError(
      'ILLEGAL_IMAGE_MAGIC',
      `真题插图文件魔数校验未通过: ${cleanRel}`,
      422
    );
  }

  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  return {
    mimeType,
    base64Data: buf.toString('base64'),
    sha256,
    byteLength: buf.byteLength,
    relativePath: `/${cleanRel}`,
  };
}

/**
 * Executes an external HTTPS request with redirect validation, max redirect cap,
 * timeout, AbortSignal support, and response body size limit.
 */
export async function safeExternalFetch(
  url: string,
  init: RequestInit,
  options: {
    maxRedirects?: number;
    timeoutMs?: number;
    maxResponseBytes?: number;
    signal?: AbortSignal;
    dnsLookupFn?: (hostname: string) => Promise<{ address: string }[]>;
  } = {}
): Promise<{ status: number; headers: Headers; bodyText: string }> {
  const maxRedirects = options.maxRedirects ?? 2;
  const timeoutMs = options.timeoutMs ?? 20000;
  const maxResponseBytes = options.maxResponseBytes ?? 2 * 1024 * 1024; // 2 MB

  let currentUrl = url;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    await validateSafeCustomBaseUrl(currentUrl, options.dnsLookupFn);

    if (options.signal?.aborted) {
      throw new SecurityError('REQUEST_CANCELLED', '请求已被用户取消', 499);
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const response = await fetch(currentUrl, {
        ...init,
        redirect: 'manual',
        signal: controller.signal,
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirectCount === maxRedirects) {
          throw new SecurityError('SSRF_TOO_MANY_REDIRECTS', '重定向次数超过安全上限', 502);
        }
        const location = response.headers.get('location');
        if (!location) {
          throw new SecurityError('SSRF_INVALID_REDIRECT', '重定向响应缺少 Location 头', 502);
        }
        const resolvedRedirect = new URL(location, currentUrl).toString();
        await validateSafeCustomBaseUrl(resolvedRedirect, options.dnsLookupFn);
        currentUrl = resolvedRedirect;
        continue;
      }

      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > maxResponseBytes) {
        throw new SecurityError(
          'RESPONSE_TOO_LARGE',
          `上游模型响应体超过安全大小限制 (${buffer.byteLength} bytes)`,
          502
        );
      }

      return {
        status: response.status,
        headers: response.headers,
        bodyText: Buffer.from(buffer).toString('utf8'),
      };
    } catch (err: any) {
      if (err instanceof SecurityError) throw err;
      if (options.signal?.aborted) {
        throw new SecurityError('REQUEST_CANCELLED', '请求已被取消', 499);
      }
      if (timedOut || err?.name === 'AbortError') {
        throw new SecurityError(
          'PROVIDER_TIMEOUT',
          `上游模型响应超时 (超过 ${timeoutMs}ms)`,
          504
        );
      }
      throw new SecurityError(
        'PROVIDER_UNAVAILABLE',
        `请求上游模型接口失败: ${err?.message || '网络异常'}`,
        502
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  throw new SecurityError('SSRF_TOO_MANY_REDIRECTS', '重定向次数超过安全上限', 502);
}

/**
 * Checks whether a given authenticated Firebase UID is in OWNER_UIDS and allowed to use server global keys.
 */
export function isUserInOwnerUids(
  uid: string | null | undefined,
  ownerUidsEnv: string = process.env.OWNER_UIDS || ''
): boolean {
  if (!uid) return false;
  const allowlist = ownerUidsEnv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowlist.includes(uid);
}

/**
 * Maps internal/upstream errors into standardized AIErrorCodes and user-friendly messages.
 */
export function normalizeToAIError(err: unknown): {
  code: AIErrorCode | string;
  status: number;
  userMessage: string;
} {
  if (err instanceof SecurityError) {
    return {
      code: err.code,
      status: err.status,
      userMessage: err.message,
    };
  }
  const msg = err instanceof Error ? err.message : String(err || '未知错误');
  if (/abort|cancel/i.test(msg)) {
    return { code: 'REQUEST_CANCELLED', status: 499, userMessage: '任务已取消' };
  }
  if (/timeout|timed out/i.test(msg)) {
    return { code: 'PROVIDER_TIMEOUT', status: 504, userMessage: '模型响应超时，请稍后重试或切换更快的模型' };
  }
  if (/401|403|api[_\s-]?key|unauthorized|invalid.*key/i.test(msg)) {
    return { code: 'PROVIDER_AUTH_FAILED', status: 401, userMessage: '供应商 API Key 认证失败，请检查密钥是否正确或是否已过期' };
  }
  if (/404|model.*not.*found|does not exist/i.test(msg)) {
    return { code: 'MODEL_NOT_FOUND', status: 404, userMessage: '目标模型不存在或当前账号无权访问该模型 ID' };
  }
  if (/429|rate.*limit|quota/i.test(msg)) {
    return { code: 'PROVIDER_RATE_LIMITED', status: 429, userMessage: '供应商接口触发限流或配额不足，请稍后重试' };
  }
  return {
    code: 'PROVIDER_UNAVAILABLE',
    status: 502,
    userMessage: msg || '模型调用失败，请检查连接或稍后重试',
  };
}

/**
 * Redacts sensitive fields from logs.
 * Never logs API keys, Authorization tokens, full essays, full translations, or raw file texts.
 */
export interface SafeLogEntry {
  requestId: string;
  runId?: string;
  uidHash: string;
  provider: string;
  model: string;
  taskType?: string;
  status: 'success' | 'error' | 'rate_limited' | 'cancelled';
  latencyMs: number;
  tokenCount?: number;
  retryCount?: number;
  finishReason?: string | null;
  providerRequestId?: string | null;
  errorCode?: string;
  timestamp: string;
}

export function createRedactedLogEntry(input: {
  requestId: string;
  runId?: string;
  uid?: string | null;
  provider: string;
  model: string;
  taskType?: string;
  status: 'success' | 'error' | 'rate_limited' | 'cancelled';
  latencyMs: number;
  tokenCount?: number;
  retryCount?: number;
  finishReason?: string | null;
  providerRequestId?: string | null;
  errorCode?: string;
  // Any accidentally passed sensitive properties will be stripped
  [key: string]: unknown;
}): SafeLogEntry {
  const uidHash = input.uid
    ? crypto.createHash('sha256').update(input.uid).digest('hex').slice(0, 12)
    : 'anonymous';

  return {
    requestId: String(input.requestId),
    ...(input.runId ? { runId: String(input.runId) } : {}),
    uidHash,
    provider: String(input.provider),
    model: String(input.model),
    ...(input.taskType ? { taskType: String(input.taskType) } : {}),
    status: input.status,
    latencyMs: Number(input.latencyMs) || 0,
    tokenCount: typeof input.tokenCount === 'number' ? input.tokenCount : undefined,
    retryCount: typeof input.retryCount === 'number' ? input.retryCount : undefined,
    finishReason: input.finishReason ?? undefined,
    providerRequestId: input.providerRequestId ?? undefined,
    errorCode: input.errorCode ? String(input.errorCode) : undefined,
    timestamp: new Date().toISOString(),
  };
}
