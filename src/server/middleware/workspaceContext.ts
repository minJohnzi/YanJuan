import type { Request } from 'express';
import { SecurityError, assertSafePathSegment } from '../securityAndCrypto.ts';

export interface WorkspaceCallerIdentity {
  uid: string;
  authenticated: boolean;
  serverAiPin: string | null;
}

export type VerifyIdTokenHook = (
  idToken: string
) => Promise<{ uid: string; email?: string }>;

/**
 * Resolves the workspace context for local-first requests.
 * Supports optional legacy bearer token verification hook when explicitly injected
 * by tests, while defaulting cleanly to X-Workspace-Id ('local-default') without
 * requiring cloud Firebase Auth.
 */
export async function resolveWorkspaceCaller(
  req: Request,
  verifyIdTokenFn?: VerifyIdTokenHook
): Promise<WorkspaceCallerIdentity> {
  const serverAiPin = req.header('X-Server-AI-Pin')?.trim() || null;

  if (verifyIdTokenFn) {
    const authHeader = req.header('Authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      if (!token) {
        throw new SecurityError('AUTH_TOKEN_INVALID', '认证 Token 为空', 401);
      }
      try {
        const verified = await verifyIdTokenFn(token);
        if (!verified?.uid) {
          throw new SecurityError('AUTH_TOKEN_INVALID', '无效的用户身份', 401);
        }
        return { uid: verified.uid, authenticated: true, serverAiPin };
      } catch (err) {
        if (err instanceof SecurityError) throw err;
        throw new SecurityError('AUTH_TOKEN_INVALID', '身份令牌验证失败或已过期', 401);
      }
    }
    return { uid: 'local-guest', authenticated: false, serverAiPin };
  }

  const rawWorkspace = req.header('X-Workspace-Id')?.trim();
  const uid = rawWorkspace
    ? assertSafePathSegment(rawWorkspace, 'X-Workspace-Id')
    : 'local-default';

  return {
    uid,
    authenticated: true,
    serverAiPin,
  };
}
