import { useEffect } from 'preact/hooks';
import type { Settings } from '@iublocker/shared';
import { sendRequest } from '@iublocker/shared';

/** `auto` leaves the choice to `prefers-color-scheme`; light/dark pin it. */
export function applyTheme(theme: Settings['theme'] | undefined): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
}

/** Applies the stored theme on mount; failures are non-fatal (the page still renders). */
export function useTheme(theme?: Settings['theme']): void {
  useEffect(() => {
    if (theme) {
      applyTheme(theme);
      return;
    }
    let cancelled = false;
    sendRequest({ type: 'settings:get' }).then(
      (settings) => {
        if (!cancelled) applyTheme(settings.theme);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [theme]);
}
