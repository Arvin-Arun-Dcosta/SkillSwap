import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'skillswap-theme';
const listeners = new Set<() => void>();

function current(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this page only.
  }
  listeners.forEach((listener) => listener());
}

/** The active colour theme. The initial value is set before paint by /theme-init.js. */
export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore<Theme>(subscribe, current, () => 'light');
  const toggle = useCallback(() => setTheme(current() === 'dark' ? 'light' : 'dark'), []);
  return [theme, toggle];
}
