import { uiLanguage } from './i18n';

let numberFormat: Intl.NumberFormat | null = null;

/** Locale-aware integer formatting (falls back to `String` where Intl is unavailable). */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  try {
    numberFormat ??= new Intl.NumberFormat(uiLanguage());
    return numberFormat.format(Math.round(n));
  } catch {
    return String(Math.round(n));
  }
}

/** Absolute timestamp for updater state; `0`/missing renders as an em dash. */
export function formatTime(ms: number | undefined): string {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleString(uiLanguage());
  } catch {
    return new Date(ms).toISOString();
  }
}

/** `hh:mm:ss.mmm` used by the logger table. */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Shorten a URL for table display without hiding its origin. */
export function shortenUrl(url: string, max = 120): string {
  if (url.length <= max) return url;
  return `${url.slice(0, max - 1)}…`;
}
