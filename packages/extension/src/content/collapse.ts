/**
 * Collapsing of blocked elements.
 *
 * DNR blocks the request but leaves the element in the DOM, so an `<img>`/`<iframe>`
 * whose request was blocked stays as a broken placeholder. We listen for `error`
 * events in the capture phase, batch the failing URLs, and ask the worker which of
 * them were actually blocked (`blocked:getForTab`). Only those are hidden — a genuine
 * 404 must stay visible.
 */

import { sendRequest } from '@iublocker/shared';
import { elementUrl, inlineStyle } from './dom';
import { MARKER_ATTR } from './procedural';

const COLLAPSIBLE = new Set(['img', 'iframe', 'embed', 'object', 'video', 'audio', 'source', 'track']);
const BATCH_DELAY_MS = 250;
const MAX_PENDING = 256;

export class Collapser {
  private readonly win: Window;
  private readonly doc: Document;
  private readonly pending = new Map<Element, string>();
  private timer: number | null = null;
  private started = false;
  private readonly onError = (ev: Event): void => this.handleError(ev);

  constructor(win: Window) {
    this.win = win;
    this.doc = win.document;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.doc.addEventListener('error', this.onError, true);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.doc.removeEventListener('error', this.onError, true);
    if (this.timer !== null) {
      this.win.clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
  }

  /** Exposed for tests: resolve the current batch against the worker's blocked list. */
  async flush(): Promise<number> {
    if (this.timer !== null) {
      this.win.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.size === 0) return 0;
    const batch = [...this.pending];
    this.pending.clear();
    let urls: string[];
    try {
      const res = await sendRequest({ type: 'blocked:getForTab' });
      urls = res.urls;
    } catch {
      return 0;
    }
    // `stop()` may have run while the round trip was in flight (mode change, teardown).
    if (!this.started) return 0;
    if (!Array.isArray(urls) || urls.length === 0) return 0;
    const blocked = new Set<string>();
    for (const url of urls) {
      blocked.add(url);
      const hash = url.indexOf('#');
      if (hash !== -1) blocked.add(url.slice(0, hash));
    }
    let collapsed = 0;
    for (const [el, url] of batch) {
      if (!blocked.has(url)) continue;
      this.collapse(el);
      collapsed += 1;
    }
    return collapsed;
  }

  private handleError(ev: Event): void {
    const target = ev.target;
    if (!target || !(target as Node).nodeType || (target as Node).nodeType !== 1) return;
    let el = target as Element;
    if (!COLLAPSIBLE.has(el.localName)) return;
    if (el.localName === 'source' || el.localName === 'track') {
      const parent = el.parentElement;
      if (!parent) return;
      el = parent;
    }
    const url = elementUrl(el);
    if (!url) return;
    if (this.pending.size >= MAX_PENDING) return;
    this.pending.set(el, url);
    if (this.timer === null) {
      this.timer = this.win.setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, BATCH_DELAY_MS);
    }
  }

  private collapse(el: Element): void {
    inlineStyle(el)?.setProperty('display', 'none', 'important');
    el.setAttribute(MARKER_ATTR, 'collapsed');
  }
}
