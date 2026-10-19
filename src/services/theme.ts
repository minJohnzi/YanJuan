import { useState, useEffect, useCallback } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'yanjuan_theme_mode';

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // fallback if localStorage restricted
  }
  return 'system';
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    return getSystemTheme();
  }
  return mode;
}

export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (resolved === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
  return resolved;
}

type ThemeListener = (mode: ThemeMode, resolved: ResolvedTheme) => void;
const listeners = new Set<ThemeListener>();

export function setAppThemeMode(newMode: ThemeMode): ResolvedTheme {
  const resolved = applyTheme(newMode);
  listeners.forEach((listener) => listener(newMode, resolved));
  return resolved;
}

export function useTheme(initialFromPrefs?: ThemeMode) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    const stored = getStoredThemeMode();
    if (stored) return stored;
    if (initialFromPrefs) return initialFromPrefs;
    return 'system';
  });

  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(getStoredThemeMode())
  );

  // Apply on mount and listen to system changes
  useEffect(() => {
    const resolved = applyTheme(themeMode);
    setResolvedTheme(resolved);

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMediaChange = () => {
      const currentStored = getStoredThemeMode();
      if (currentStored === 'system') {
        const res = applyTheme('system');
        setResolvedTheme(res);
        listeners.forEach((listener) => listener('system', res));
      }
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleMediaChange);
    } else {
      mediaQuery.addListener(handleMediaChange);
    }

    const themeListener: ThemeListener = (mode, res) => {
      setThemeModeState(mode);
      setResolvedTheme(res);
    };
    listeners.add(themeListener);

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleMediaChange);
      } else {
        mediaQuery.removeListener(handleMediaChange);
      }
      listeners.delete(themeListener);
    };
  }, [themeMode]);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    setAppThemeMode(mode);
  }, []);

  const toggleQuickTheme = useCallback(() => {
    // Quick toggle between light and dark
    const nextMode: ThemeMode = resolvedTheme === 'dark' ? 'light' : 'dark';
    setTheme(nextMode);
  }, [resolvedTheme, setTheme]);

  return {
    themeMode,
    resolvedTheme,
    setTheme,
    toggleQuickTheme,
  };
}
