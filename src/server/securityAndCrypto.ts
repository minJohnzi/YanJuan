import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

export interface EncryptedCredentialRecord {
  provider: 'gemini' | 'deepseek' | 'openai-compatible';
  ciphertext: string;
  iv: string;
  authTag: string;
  encryptionVersion: number;
  maskedKey: string;
  model: string;
  baseUrl?: string;
  lastTestedAt: string | null;
  lastTestStatus: 'success' | 'failed' | 'untested';
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

/**
 * Derives a 32-byte AES-256 key from CREDENTIAL_ENCRYPTION_KEY environment variable
 * (or deterministic server runtime secret when unconfigured in local dev).
 */
function getMasterEncryptionKey(explicitSecret?: string): Buffer {
  const raw =
    explicitSecret ||
    process.env.CREDENTIAL_ENCRYPTION_KEY ||
    'yanjuan-desk-local-dev-fallback-key-do-not-use-in-prod-2026';
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

/**
 * Encrypts a user API key using AES-256-GCM with random 12-byte IV and (uid + provider) as AAD.
 */
export function encryptProviderApiKey(
  uid: string,
  provider: 'gemini' | 'deepseek' | 'openai-compatible',
  plainApiKey: string,
  options: {
    model: string;
    baseUrl?: string;
    secretOverride?: string;
  }
): EncryptedCredentialRecord {
  if (!uid || !plainApiKey || plainApiKey.trim().length < 6) {
    throw new SecurityError('INVALID_API_KEY', 'API Key 长度或格式无效', 400);
  }
  const cleanKey = plainApiKey.trim();
  const key = getMasterEncryptionKey(options.secretOverride);
  const iv = crypto.randomBytes(12);
  const aad = Buffer.from(`${uid}:${provider}:v1`, 'utf8');

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([
    cipher.update(cleanKey, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    provider,
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    encryptionVersion: 1,
    maskedKey: maskApiKey(cleanKey),
    model: options.model,
    baseUrl: options.baseUrl,
    lastTestedAt: null,
    lastTestStatus: 'untested',
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Decrypts an AES-256-GCM encrypted API key on the server.
 * Fails immediately if uid or provider does not match the bound AAD.
 */
export function decryptProviderApiKey(
  uid: string,
  provider: 'gemini' | 'deepseek' | 'openai-compatible',
  record: Pick<EncryptedCredentialRecord, 'ciphertext' | 'iv' | 'authTag' | 'encryptionVersion'>,
  secretOverride?: string
): string {
  const key = getMasterEncryptionKey(secretOverride);
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
    throw new SecurityError('SSRF_INVALID_URL', '自定义 Base URL 不能为空', 400);
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new SecurityError('SSRF_INVALID_URL', `无效的 URL 格式: ${rawUrl}`, 400);
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
      'SSRF_CREDENTIALS_IN_URL_FORBIDDEN',
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
 * Executes an external HTTPS request with redirect validation, max redirect cap,
 * timeout, and response body size limit.
 */
export async function safeExternalFetch(
  url: string,
  init: RequestInit,
  options: {
    maxRedirects?: number;
    timeoutMs?: number;
    maxResponseBytes?: number;
    dnsLookupFn?: (hostname: string) => Promise<{ address: string }[]>;
  } = {}
): Promise<{ status: number; headers: Headers; bodyText: string }> {
  const maxRedirects = options.maxRedirects ?? 2;
  const timeoutMs = options.timeoutMs ?? 20000;
  const maxResponseBytes = options.maxResponseBytes ?? 2 * 1024 * 1024; // 2 MB

  let currentUrl = url;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    await validateSafeCustomBaseUrl(currentUrl, options.dnsLookupFn);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

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
    } finally {
      clearTimeout(timer);
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
 * Redacts sensitive fields from logs to enforce Section 二十八 privacy rules.
 * Never logs API keys, Authorization tokens, full essays, full translations, or raw file texts.
 */
export interface SafeLogEntry {
  requestId: string;
  uidHash: string;
  provider: string;
  model: string;
  status: 'success' | 'error' | 'rate_limited';
  latencyMs: number;
  tokenCount?: number;
  errorCode?: string;
  timestamp: string;
}

export function createRedactedLogEntry(input: {
  requestId: string;
  uid?: string | null;
  provider: string;
  model: string;
  status: 'success' | 'error' | 'rate_limited';
  latencyMs: number;
  tokenCount?: number;
  errorCode?: string;
  // Any accidentally passed sensitive properties will be stripped
  [key: string]: unknown;
}): SafeLogEntry {
  const uidHash = input.uid
    ? crypto.createHash('sha256').update(input.uid).digest('hex').slice(0, 12)
    : 'anonymous';

  return {
    requestId: String(input.requestId),
    uidHash,
    provider: String(input.provider),
    model: String(input.model),
    status: input.status,
    latencyMs: Number(input.latencyMs) || 0,
    tokenCount: typeof input.tokenCount === 'number' ? input.tokenCount : undefined,
    errorCode: input.errorCode ? String(input.errorCode) : undefined,
    timestamp: new Date().toISOString(),
  };
}
