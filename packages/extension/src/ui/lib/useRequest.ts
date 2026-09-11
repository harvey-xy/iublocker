import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Event as ExtensionEvent, Request, ResponseFor } from '@iublocker/shared';
import { sendRequest } from '@iublocker/shared';

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err);
}

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Re-issue the request. */
  reload: () => void;
  /** Replace the cached response locally (after a mutation that returns fresh data). */
  set: (data: T) => void;
}

/**
 * Issue a typed router request and track loading/error state.
 * `make` returns `null` when the request cannot be issued yet (e.g. no tab id).
 */
export function useRequest<R extends Request>(
  make: () => R | null,
  deps: readonly unknown[],
): AsyncState<ResponseFor<R['type']>> {
  type T = ResponseFor<R['type']>;
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [nonce, setNonce] = useState(0);
  const makeRef = useRef(make);
  makeRef.current = make;

  useEffect(() => {
    const req = makeRef.current();
    if (req === null) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));
    sendRequest(req).then(
      (data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      },
      (err: unknown) => {
        if (!cancelled) setState({ data: null, error: errorMessage(err), loading: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const set = useCallback((data: T) => setState({ data, error: null, loading: false }), []);
  return { ...state, reload, set };
}

/** Subscribe to `event:*` broadcasts from the service worker. */
export function useExtensionEvent(handler: (event: ExtensionEvent) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = (message: unknown) => {
      if (typeof message !== 'object' || message === null) return;
      const type = (message as { type?: unknown }).type;
      if (typeof type !== 'string' || !type.startsWith('event:')) return;
      ref.current(message as ExtensionEvent);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
}
