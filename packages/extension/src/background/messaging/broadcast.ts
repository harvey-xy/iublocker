/**
 * Fire-and-forget events to extension pages. docs/MESSAGING.md "Conventions".
 * Nobody may be listening (no popup open) — that rejection is expected and swallowed.
 */
import type { Event } from '@iublocker/shared';
import { log } from '../log';

export function broadcast(event: Event): void {
  try {
    const maybePromise = chrome.runtime.sendMessage(event) as unknown as Promise<unknown> | undefined;
    if (maybePromise && typeof maybePromise.catch === 'function') {
      maybePromise.catch(() => undefined);
    }
    // Reading lastError suppresses "Could not establish connection" noise.
    void chrome.runtime.lastError;
  } catch (err) {
    log.debug('broadcast failed', err);
  }
}
