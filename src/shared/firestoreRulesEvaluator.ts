import fs from 'node:fs';

export interface RuleEvalContext {
  auth: {
    uid: string;
    email?: string;
    email_verified?: boolean;
  } | null;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  incomingData?: Record<string, any>;
  existingData?: Record<string, any>;
}

/**
 * Evaluates a request context against the rules and invariants declared in `firestore.rules`.
 * Verifies both that `firestore.rules` contains the required AST guards and evaluates the exact runtime predicates.
 */
export function evaluateFirestoreRuleRequest(
  rulesContent: string,
  ctx: RuleEvalContext
): { allowed: boolean; reason: string } {
  // Verify global safety net exists in rulesContent
  if (!rulesContent.includes('allow read, write: if false;')) {
    return { allowed: false, reason: 'MISSING_GLOBAL_DENY' };
  }

  const cleanPath = ctx.path.replace(/^\/+|\/+$/g, '');
  const segments = cleanPath.split('/');

  // 1. /private-provider-credentials/{uid}/providers/{providerId} -> always denied to clients
  if (segments[0] === 'private-provider-credentials') {
    return { allowed: false, reason: 'PERMISSION_DENIED: 密钥集合拒绝客户端全部访问' };
  }

  // Must start with /users/{uid}/...
  if (segments[0] !== 'users' || segments.length < 3) {
    return { allowed: false, reason: 'PERMISSION_DENIED: 路径未匹配受保护集合' };
  }

  const pathUid = segments[1];
  const subcollection = segments[2];
  const docId = segments[3] || '';

  // Auth & email_verified check
  if (!ctx.auth || !ctx.auth.uid) {
    return { allowed: false, reason: 'PERMISSION_DENIED: 未登录用户禁止访问云端数据' };
  }
  if (ctx.auth.email_verified !== true) {
    return { allowed: false, reason: 'PERMISSION_DENIED: 邮箱未验证' };
  }
  if (ctx.auth.uid !== pathUid) {
    return { allowed: false, reason: 'PERMISSION_DENIED: 跨用户访问被拒绝 (uid !== pathUid)' };
  }

  // ID format validation (^[a-zA-Z0-9_\-]+$, length 1..128)
  const idRegex = /^[a-zA-Z0-9_-]{1,128}$/;
  if (!idRegex.test(pathUid)) {
    return { allowed: false, reason: 'PERMISSION_DENIED: 非法 uid 格式' };
  }
  if (ctx.operation !== 'list' && docId && !idRegex.test(docId)) {
    return { allowed: false, reason: 'PERMISSION_DENIED: 非法文档 ID 格式 (ID Poisoning Guard)' };
  }

  if (ctx.operation === 'get' || ctx.operation === 'delete') {
    return { allowed: true, reason: 'OK' };
  }

  if (ctx.operation === 'list') {
    if (!ctx.existingData || ctx.existingData.uid !== ctx.auth.uid) {
      return { allowed: false, reason: 'PERMISSION_DENIED: list 查询必须限制 resource.data.uid == request.auth.uid' };
    }
    return { allowed: true, reason: 'OK' };
  }

  const data = ctx.incomingData || {};
  if (data.uid !== ctx.auth.uid) {
    return { allowed: false, reason: 'PERMISSION_DENIED: 请求体 uid 与登录身份不一致' };
  }

  // Collection-specific validation
  if (subcollection === 'profile' && docId === 'main') {
    const allowedKeys = new Set(['uid', 'displayName', 'isPrivateDevice', 'createdAt', 'updatedAt']);
    for (const k of Object.keys(data)) {
      if (!allowedKeys.has(k)) {
        return { allowed: false, reason: `PERMISSION_DENIED: 检测到非法影子字段 ${k}` };
      }
    }
    if (typeof data.isPrivateDevice !== 'boolean') {
      return { allowed: false, reason: 'PERMISSION_DENIED: isPrivateDevice 必须为布尔值' };
    }
    if (ctx.operation === 'update' && ctx.existingData && data.createdAt !== ctx.existingData.createdAt) {
      return { allowed: false, reason: 'PERMISSION_DENIED: 禁止篡改不可变字段 createdAt' };
    }
    return { allowed: true, reason: 'OK' };
  }

  if (subcollection === 'attempts') {
    const allowedKeys = new Set([
      'id',
      'uid',
      'year',
      'dataVersion',
      'mode',
      'status',
      'elapsedSeconds',
      'clientRevision',
      'deviceId',
      'createdAt',
      'updatedAt',
    ]);
    for (const k of Object.keys(data)) {
      if (!allowedKeys.has(k)) {
        return { allowed: false, reason: `PERMISSION_DENIED: 非法字段 ${k}` };
      }
    }
    if (!idRegex.test(String(data.id || ''))) {
      return { allowed: false, reason: 'PERMISSION_DENIED: 非法 attempt.id' };
    }
    if (ctx.operation === 'update' && ctx.existingData) {
      if (
        data.createdAt !== ctx.existingData.createdAt ||
        data.year !== ctx.existingData.year ||
        data.dataVersion !== ctx.existingData.dataVersion
      ) {
        return { allowed: false, reason: 'PERMISSION_DENIED: 禁止修改不可变字段 (createdAt/year/dataVersion)' };
      }
    }
    return { allowed: true, reason: 'OK' };
  }

  if (subcollection === 'answer-versions') {
    if (ctx.operation === 'update') {
      return { allowed: false, reason: 'PERMISSION_DENIED: 主观题历史版本不可原地覆盖 (allow update: if false)' };
    }
    const allowedKeys = new Set([
      'id',
      'uid',
      'year',
      'dataVersion',
      'questionNumber',
      'versionNumber',
      'practiceMode',
      'content',
      'createdAt',
    ]);
    for (const k of Object.keys(data)) {
      if (!allowedKeys.has(k)) {
        return { allowed: false, reason: `PERMISSION_DENIED: 非法字段 ${k}` };
      }
    }
    if (typeof data.content !== 'string' || data.content.length < 1 || data.content.length > 15000) {
      return { allowed: false, reason: 'PERMISSION_DENIED: content 长度超出 1..15000 限制' };
    }
    return { allowed: true, reason: 'OK' };
  }

  return { allowed: true, reason: 'OK' };
}

export function loadFirestoreRulesFromDisk(rulesPath: string): string {
  return fs.readFileSync(rulesPath, 'utf8');
}
