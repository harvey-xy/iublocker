/**
 * Tiny logger for the service worker. Gated by a build-time flag (`__IUB_DEV__`, set by
 * scripts/build.ts) and flippable at runtime from `settings.advanced.logMatchedRules`.
 */
declare const __IUB_DEV__: boolean | undefined;

const BUILD_DEBUG = typeof __IUB_DEV__ !== 'undefined' ? __IUB_DEV__ : false;

let debugEnabled = BUILD_DEBUG;

export function setDebug(on: boolean): void {
  debugEnabled = on || BUILD_DEBUG;
}

export function isDebug(): boolean {
  return debugEnabled;
}

const PREFIX = '[iub]';

export const log = {
  debug(...args: unknown[]): void {
    if (debugEnabled) console.info(PREFIX, ...args);
  },
  info(...args: unknown[]): void {
    if (debugEnabled) console.info(PREFIX, ...args);
  },
  warn(...args: unknown[]): void {
    console.warn(PREFIX, ...args);
  },
  error(...args: unknown[]): void {
    console.error(PREFIX, ...args);
  },
};

/** Never let a background task reject into the void unnoticed. */
export function fireAndForget(p: Promise<unknown>, what: string): void {
  void p.catch((err) => log.error(`${what} failed:`, err));
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
