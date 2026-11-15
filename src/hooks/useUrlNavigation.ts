import { useCallback, useEffect } from 'react';

export type NavTab = 'home' | 'library' | 'review' | 'stats' | 'settings';

export interface UrlNavSnapshot {
  tab: NavTab;
  paperYear?: number | null;
  unitId?: string | null;
  mode?: string | null;
  attemptId?: string | null;
  questionNumber?: number | null;
}

const VALID_TABS = new Set<NavTab>([
  'home',
  'library',
  'review',
  'stats',
  'settings',
]);

export function readUrlNavigationSnapshot(): UrlNavSnapshot {
  try {
    const params = new URLSearchParams(window.location.search);
    const rawTab = params.get('tab') as NavTab | null;
    const tab: NavTab = rawTab && VALID_TABS.has(rawTab) ? rawTab : 'home';
    const rawPaper = params.get('paper');
    const paperYear =
      rawPaper && /^\d+$/.test(rawPaper) ? Number(rawPaper) : null;
    const unitId = params.get('unit') || null;
    const mode = params.get('mode') || null;
    const attemptId = params.get('attempt') || null;
    const rawQ = params.get('q');
    const questionNumber =
      rawQ && /^\d+$/.test(rawQ) ? Number(rawQ) : null;
    return { tab, paperYear, unitId, mode, attemptId, questionNumber };
  } catch {
    return {
      tab: 'home',
      paperYear: null,
      unitId: null,
      mode: null,
      attemptId: null,
      questionNumber: null,
    };
  }
}

export function useUrlNavigation(
  onPopState: (snapshot: UrlNavSnapshot) => void
) {
  const syncUrl = useCallback((snapshot: UrlNavSnapshot, replace = false) => {
    try {
      const params = new URLSearchParams(window.location.search);
      params.delete('__aistudio_auth_token');
      if (snapshot.tab && snapshot.tab !== 'home') {
        params.set('tab', snapshot.tab);
      } else {
        params.delete('tab');
      }
      if (snapshot.paperYear) {
        params.set('paper', String(snapshot.paperYear));
      } else {
        params.delete('paper');
      }
      if (snapshot.unitId) {
        params.set('unit', snapshot.unitId);
      } else {
        params.delete('unit');
      }
      if (snapshot.mode) {
        params.set('mode', snapshot.mode);
      } else {
        params.delete('mode');
      }
      if (snapshot.attemptId) {
        params.set('attempt', snapshot.attemptId);
      } else {
        params.delete('attempt');
      }
      if (snapshot.questionNumber) {
        params.set('q', String(snapshot.questionNumber));
      } else {
        params.delete('q');
      }
      const search = params.toString();
      const basePath =
        !window.location.pathname || window.location.pathname === '/YANJUAN'
          ? '/'
          : window.location.pathname;
      const nextUrl = search
        ? basePath === '/'
          ? `/?${search}`
          : `${basePath}?${search}`
        : basePath;
      if (window.location.pathname + window.location.search !== nextUrl) {
        if (replace) {
          window.history.replaceState(null, '', nextUrl);
        } else {
          window.history.pushState(null, '', nextUrl);
        }
      }
    } catch {
      // ignore history errors in sandboxed iframes
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      onPopState(readUrlNavigationSnapshot());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [onPopState]);

  return { syncUrl };
}
