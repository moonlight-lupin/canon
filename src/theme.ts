// The appearance switch (0.20.1): public/theme.js does the work (it runs before the page is drawn); this is its
// typed handle for the app.
import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'auto' | 'light' | 'dark';

declare global {
  interface Window {
    canonTheme?: { get(): ThemeChoice; set(v: ThemeChoice): void };
  }
}

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const current = (): ThemeChoice => window.canonTheme?.get() ?? 'auto';

/** The chosen appearance and a setter (remembered in this browser). */
export function useTheme(): [ThemeChoice, (v: ThemeChoice) => void] {
  const theme = useSyncExternalStore(subscribe, current, () => 'auto' as ThemeChoice);
  const set = (v: ThemeChoice) => {
    window.canonTheme?.set(v);
    listeners.forEach((fn) => fn());
  };
  return [theme, set];
}
