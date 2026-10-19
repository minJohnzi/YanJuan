import crypto from 'node:crypto';
import path from 'node:path';
import zlib from 'node:zlib';

export interface SafeArchiveEntry {
  fileName: string;
  extension: 'md' | 'png' | 'jpg' | 'jpeg' | 'pdf' | 'docx' | 'json';
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  buffer: Buffer;
}

export interface ZipSecurityLimits {
  maxEntryCount?: number;
  maxSingleFileBytes?: number;
  maxTotalUncompressedBytes?: number;
  maxCompressionRatio?: number;
}

const DEFAULT_LIMITS: Required<ZipSecurityLimits> = {
  maxEntryCount: 64,
  maxSingleFileBytes: 20 * 1024 * 1024, // 20 MB
  maxTotalUncompressedBytes: 50 * 1024 * 1024, // 50 MB
  maxCompressionRatio: 100, // 100:1
};

export class PipelineSecurityError extends Error {
  public readonly code: string;
  public readonly details: string[];

  constructor(code: string, message: string, details: string[] = []) {
    super(`${code}: ${message}`);
    this.code = code;
    this.details = details;
  }
}

export function computeSha256(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Validates that a relative path inside a ZIP or Markdown reference is safe.
 */
export function validateSafeRelativePath(rawPath: string): string {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new PipelineSecurityError('ZIP_PATH_TRAVERSAL', '文件路径不能为空');
  }
  if (rawPath.includes('\0')) {
    throw new PipelineSecurityError('ZIP_PATH_TRAVERSAL', '文件路径包含非法空字节', [rawPath]);
  }
  const trimmed = rawPath.trim();
  if (
    /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('javascript:')
  ) {
    throw new PipelineSecurityError(
      'UNSUPPORTED_EXTERNAL_RESOURCE',
      `禁止引用外部或协议资源路径: ${trimmed}`,
      [trimmed]
    );
  }

  const normalizedSlashes = trimmed.replace(/\\/g, '/');
  if (
    normalizedSlashes.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalizedSlashes) ||
    normalizedSlashes.split('/').some((seg) => seg === '..')
  ) {
    throw new PipelineSecurityError(
      'ZIP_PATH_TRAVERSAL',
      `检测到路径穿越或绝对路径: ${rawPath}`,
      [rawPath]
    );
  }

  const normalized = path.posix.normalize(normalizedSlashes).replace(/^\.\//, '');
  if (normalized.startsWith('..') || normalized.startsWith('/')) {
    throw new PipelineSecurityError(
      'ZIP_PATH_TRAVERSAL',
      `规范化后仍存在路径穿越: ${rawPath}`,
      [rawPath]
    );
  }
  return normalized;
}

/**
 * Verifies magic bytes match the declared file extension to block spoofed extensions and illegal MIME types.
 */
export function verifyFileTypeAndMagicBytes(
  fileName: string,
  buffer: Buffer
): { extension: SafeArchiveEntry['extension']; mimeType: string } {
  const extRaw = path.posix.extname(fileName).toLowerCase().replace(/^\./, '');
  const allowedExts = ['md', 'png', 'jpg', 'jpeg', 'pdf', 'docx', 'json'];
  if (!allowedExts.includes(extRaw)) {
    throw new PipelineSecurityError(
      'ILLEGAL_MIME_TYPE',
      `不支持的文件扩展名: .${extRaw} (${fileName})`,
      [fileName]
    );
  }
  const ext = extRaw as SafeArchiveEntry['extension'];

  if (buffer.length === 0) {
    throw new PipelineSecurityError('ILLEGAL_MIME_TYPE', `文件为空: ${fileName}`, [fileName]);
  }

  if (ext === 'png') {
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(pngMagic)) {
      throw new PipelineSecurityError(
        'SPOOFED_EXTENSION',
        `PNG文件头签名校验失败，疑似伪造扩展名: ${fileName}`,
        [fileName]
      );
    }
    return { extension: 'png', mimeType: 'image/png' };
  }

  if (ext === 'jpg' || ext === 'jpeg') {
    if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
      throw new PipelineSecurityError(
        'SPOOFED_EXTENSION',
        `JPEG文件头签名校验失败，疑似伪造扩展名: ${fileName}`,
        [fileName]
      );
    }
    return { extension: ext, mimeType: 'image/jpeg' };
  }

  if (ext === 'pdf') {
    const header = buffer.subarray(0, 5).toString('ascii');
    if (header !== '%PDF-') {
      throw new PipelineSecurityError(
        'SPOOFED_EXTENSION',
        `PDF文件头签名校验失败，疑似伪造扩展名: ${fileName}`,
        [fileName]
      );
    }
    return { extension: 'pdf', mimeType: 'application/pdf' };
  }

  if (ext === 'docx') {
    // DOCX is an OOXML ZIP container starting with PK\x03\x04
    if (
      buffer.length < 4 ||
      buffer[0] !== 0x50 ||
      buffer[1] !== 0x4b ||
      buffer[2] !== 0x03 ||
      buffer[3] !== 0x04
    ) {
      throw new PipelineSecurityError(
        'SPOOFED_EXTENSION',
        `DOCX容器签名校验失败，疑似伪造扩展名: ${fileName}`,
        [fileName]
      );
    }
    return {
      extension: 'docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }

  if (ext === 'md' || ext === 'json') {
    // Reject binary files masquerading as Markdown/JSON (e.g. PNG/EXE/ZIP header or null bytes)
    if (
      (buffer.length >= 4 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47) ||
      (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) ||
      buffer.subarray(0, Math.min(buffer.length, 4096)).includes(0x00)
    ) {
      throw new PipelineSecurityError(
        'SPOOFED_EXTENSION',
        `文本文件包含二进制特征字节，疑似伪造扩展名: ${fileName}`,
        [fileName]
      );
    }
    return {
      extension: ext,
      mimeType: ext === 'md' ? 'text/markdown' : 'application/json',
    };
  }

  throw new PipelineSecurityError('ILLEGAL_MIME_TYPE', `未知文件类型: ${fileName}`);
}

/**
 * Neutralizes prompt-injection attempts inside untrusted exam documents while preserving all exam text.
 * All document text is treated strictly as exam material data, never as system instructions.
 */
export function sanitizeExamDocumentText(rawText: string): {
  sanitizedText: string;
  detectedInjectionPatterns: string[];
} {
  const detected: string[] = [];
  const patterns: { name: string; regex: RegExp }[] = [
    {
      name: 'system_prompt_override',
      regex: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/gi,
    },
    {
      name: 'role_hijack_cn',
      regex: /忽略(之前|以上|所有)的?(指令|要求|系统提示)/g,
    },
    {
      name: 'fake_system_tag',
      regex: /<\s*\/?\s*(system|instruction|developer_prompt)\s*>/gi,
    },
  ];

  let text = rawText;
  for (const p of patterns) {
    if (p.regex.test(text)) {
      detected.push(p.name);
      // Keep text readable as literal quote if part of an article, but strip control tags
      if (p.name === 'fake_system_tag') {
        text = text.replace(p.regex, '');
      }
    }
  }
  return { sanitizedText: text, detectedInjectionPatterns: detected };
}

/**
 * Safely extracts a standard PKZIP buffer in memory with full protection against
 * path traversal, zip bombs, oversized files, spoofed extensions, and duplicate hashes.
 */
export function extractZipSafely(
  zipBuffer: Buffer,
  limits: ZipSecurityLimits = {}
): SafeArchiveEntry[] {
  const cfg = { ...DEFAULT_LIMITS, ...limits };

  if (
    zipBuffer.length < 22 ||
    zipBuffer[0] !== 0x50 ||
    zipBuffer[1] !== 0x4b
  ) {
    throw new PipelineSecurityError('ILLEGAL_MIME_TYPE', '无效的 ZIP 压缩包文件头');
  }

  // Locate End of Central Directory (EOCD) signature 0x06054b50
  let eocdOffset = -1;
  const minSearchOffset = Math.max(0, zipBuffer.length - 65557);
  for (let i = zipBuffer.length - 22; i >= minSearchOffset; i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new PipelineSecurityError('ILLEGAL_MIME_TYPE', 'ZIP 缺少中央目录结束记录 (EOCD)');
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  if (totalEntries > cfg.maxEntryCount) {
    throw new PipelineSecurityError(
      'ZIP_BOMB_DETECTED',
      `压缩包内文件数量 (${totalEntries}) 超过安全上限 (${cfg.maxEntryCount})`
    );
  }

  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  let ptr = cdOffset;
  let totalUncompressed = 0;
  const entries: SafeArchiveEntry[] = [];
  const seenHashes = new Map<string, string>();

  for (let idx = 0; idx < totalEntries; idx++) {
    if (ptr + 46 > zipBuffer.length || zipBuffer.readUInt32LE(ptr) !== 0x02014b50) {
      throw new PipelineSecurityError('ILLEGAL_MIME_TYPE', '损坏的 ZIP 中央目录条目');
    }

    const compressionMethod = zipBuffer.readUInt16LE(ptr + 10);
    const compressedSize = zipBuffer.readUInt32LE(ptr + 20);
    const declaredUncompressedSize = zipBuffer.readUInt32LE(ptr + 24);
    const fileNameLen = zipBuffer.readUInt16LE(ptr + 28);
    const extraLen = zipBuffer.readUInt16LE(ptr + 30);
    const commentLen = zipBuffer.readUInt16LE(ptr + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(ptr + 42);

    const rawFileName = zipBuffer
      .subarray(ptr + 46, ptr + 46 + fileNameLen)
      .toString('utf8');
    ptr += 46 + fileNameLen + extraLen + commentLen;

    // Skip directory entries
    if (rawFileName.endsWith('/')) {
      continue;
    }

    const safeName = validateSafeRelativePath(rawFileName);

    // Check declared size and compression ratio before decompressing
    if (declaredUncompressedSize > cfg.maxSingleFileBytes) {
      throw new PipelineSecurityError(
        'FILE_TOO_LARGE',
        `单个文件 (${safeName}) 大小超过安全上限 (${declaredUncompressedSize} bytes)`,
        [safeName]
      );
    }

    if (
      compressedSize > 0 &&
      declaredUncompressedSize / compressedSize > cfg.maxCompressionRatio
    ) {
      throw new PipelineSecurityError(
        'ZIP_BOMB_DETECTED',
        `检测到异常高压缩比 (${Math.round(
          declaredUncompressedSize / compressedSize
        )}:1)，疑似 ZIP 炸弹: ${safeName}`,
        [safeName]
      );
    }

    if (
      localHeaderOffset + 30 > zipBuffer.length ||
      zipBuffer.readUInt32LE(localHeaderOffset) !== 0x04034b50
    ) {
      throw new PipelineSecurityError('ILLEGAL_MIME_TYPE', `损坏的本地文件头: ${safeName}`);
    }

    const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressedSlice = zipBuffer.subarray(dataStart, dataStart + compressedSize);

    let uncompressed: Buffer;
    if (compressionMethod === 0) {
      uncompressed = Buffer.from(compressedSlice);
    } else if (compressionMethod === 8) {
      uncompressed = zlib.inflateRawSync(compressedSlice, {
        maxOutputLength: cfg.maxSingleFileBytes,
      });
    } else {
      throw new PipelineSecurityError(
        'ILLEGAL_MIME_TYPE',
        `不支持的 ZIP 压缩算法 (${compressionMethod}): ${safeName}`
      );
    }

    if (
      compressedSize > 0 &&
      uncompressed.length / compressedSize > cfg.maxCompressionRatio
    ) {
      throw new PipelineSecurityError(
        'ZIP_BOMB_DETECTED',
        `实际解压比超出上限: ${safeName}`,
        [safeName]
      );
    }

    totalUncompressed += uncompressed.length;
    if (totalUncompressed > cfg.maxTotalUncompressedBytes) {
      throw new PipelineSecurityError(
        'ZIP_BOMB_DETECTED',
        `ZIP 解压总大小超过安全上限 (${cfg.maxTotalUncompressedBytes} bytes)`
      );
    }

    const { extension, mimeType } = verifyFileTypeAndMagicBytes(safeName, uncompressed);
    const sha256 = computeSha256(uncompressed);

    if (seenHashes.has(sha256)) {
      throw new PipelineSecurityError(
        'DUPLICATE_FILE_HASH',
        `检测到重复内容文件: ${safeName} 与 ${seenHashes.get(sha256)} 哈希一致`,
        [safeName, seenHashes.get(sha256)!]
      );
    }
    seenHashes.set(sha256, safeName);

    entries.push({
      fileName: safeName,
      extension,
      mimeType,
      sizeBytes: uncompressed.length,
      sha256,
      buffer: uncompressed,
    });
  }

  return entries;
}

/**
 * Computes CRC32 for creating standard PKZIP archives.
 */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Creates a valid PKZIP buffer from a list of files `{ fileName, data }`.
 */
export function createZipArchive(files: { fileName: string; data: Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.fileName, 'utf8');
    const uncompressed = file.data;
    const compressed = zlib.deflateRawSync(uncompressed);
    const fileCrc = crc32(uncompressed);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(8, 8); // deflate
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(fileCrc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const localRecord = Buffer.concat([localHeader, nameBuf, compressed]);
    localParts.push(localRecord);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(fileCrc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(Buffer.concat([centralHeader, nameBuf]));
    offset += localRecord.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}
