import type { SystemCapabilitiesResponse } from '../shared/types.ts';

const WORKSPACE_ID_STORAGE_KEY = 'yanjuan_workspace_id';
const SERVER_PIN_STORAGE_KEY = 'yanjuan_server_ai_pin';
export const DEFAULT_WORKSPACE_ID = 'local-default';

export function getWorkspaceId(): string {
  if (typeof window === 'undefined') return DEFAULT_WORKSPACE_ID;
  try {
    const existing = window.localStorage.getItem(WORKSPACE_ID_STORAGE_KEY);
    if (existing && /^[A-Za-z0-9_-]{3,64}$/.test(existing.trim())) {
      return existing.trim();
    }
    window.localStorage.setItem(WORKSPACE_ID_STORAGE_KEY, DEFAULT_WORKSPACE_ID);
  } catch {
    // ignore storage access issues
  }
  return DEFAULT_WORKSPACE_ID;
}

export function setWorkspaceId(workspaceId: string): string {
  const cleaned = workspaceId.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  const effective = cleaned.length >= 3 ? cleaned : DEFAULT_WORKSPACE_ID;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(WORKSPACE_ID_STORAGE_KEY, effective);
    } catch {
      // ignore
    }
  }
  return effective;
}

export function getServerAiPin(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.sessionStorage.getItem(SERVER_PIN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setServerAiPin(pin: string): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = pin.trim();
    if (trimmed) {
      window.sessionStorage.setItem(SERVER_PIN_STORAGE_KEY, trimmed);
    } else {
      window.sessionStorage.removeItem(SERVER_PIN_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export function buildLocalApiHeaders(
  extraHeaders: Record<string, string> = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Workspace-Id': getWorkspaceId(),
    ...extraHeaders,
  };
  const pin = getServerAiPin();
  if (pin) {
    headers['X-Server-AI-Pin'] = pin;
  }
  return headers;
}

export async function fetchSystemCapabilities(): Promise<SystemCapabilitiesResponse | null> {
  try {
    const res = await fetch('/api/v1/system/capabilities', {
      headers: buildLocalApiHeaders(),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return (body.data || body) as SystemCapabilitiesResponse;
  } catch {
    return null;
  }
}
