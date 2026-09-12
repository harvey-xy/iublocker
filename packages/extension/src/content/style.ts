/**
 * The single `<style>` element the cosmetic engine owns.
 *
 * docs/COSMETIC-FILTERING.md §3: created on `document.documentElement` before `<head>`
 * exists, moved into `<head>` once it is parsed, appended to (never rewritten), and
 * re-appended when the page removes it.
 */

/** Selectors are joined into chunks so a single rule never grows unbounded. */
const SELECTORS_PER_RULE = 1000;
/**
 * How many times the observer re-attaches the element before it gives up. A page that
 * removes it in its own `MutationObserver` would otherwise ping-pong with us in an
 * unbounded microtask loop that pegs the main thread. After the cap we stop observing;
 * the engine still calls `ensureAttached()` once per pass (≥ 100 ms apart), so hiding
 * recovers without the busy loop.
 */
const MAX_OBSERVED_REATTACH = 50;
export const HIDE_DECLARATION = 'display:none!important;';

export class StyleManager {
  private readonly doc: Document;
  private readonly id: string;
  private el: HTMLStyleElement | null = null;
  private parent: Element | null = null;
  private observer: MutationObserver | null = null;
  private readonly injected = new Set<string>();
  private destroyed = false;
  private reattached = 0;

  constructor(doc: Document, id = 'iub-cosmetic') {
    this.doc = doc;
    this.id = id;
  }

  /** The managed element, created on first use. */
  element(): HTMLStyleElement | null {
    if (this.destroyed) return null;
    if (this.el) {
      this.ensureAttached();
      return this.el;
    }
    const root = this.doc.documentElement;
    if (!root) return null;
    const el = this.doc.createElement('style');
    el.id = this.id;
    el.setAttribute('type', 'text/css');
    this.el = el;
    this.ensureAttached();
    return el;
  }

  /** Re-attaches the element if the page removed it, and moves it into `<head>` when possible. */
  ensureAttached(): void {
    const el = this.el;
    if (this.destroyed || !el) return;
    const parent: Element | null = this.doc.head ?? this.doc.documentElement;
    if (!parent) return;
    if (el.parentNode !== parent) {
      parent.appendChild(el);
      this.reattached += 1;
      if (this.reattached > MAX_OBSERVED_REATTACH) {
        this.observer?.disconnect();
        this.observer = null;
      }
    }
    if (this.parent !== parent) {
      this.parent = parent;
      this.observeParent(parent);
    }
  }

  /** Appends `selectors{display:none!important}`; already-injected selectors are skipped. */
  hide(selectors: readonly string[]): number {
    const fresh: string[] = [];
    for (const selector of selectors) {
      const s = selector.trim();
      if (!s || this.injected.has(s)) continue;
      this.injected.add(s);
      fresh.push(s);
    }
    if (fresh.length === 0) return 0;
    for (let i = 0; i < fresh.length; i += SELECTORS_PER_RULE) {
      const chunk = fresh.slice(i, i + SELECTORS_PER_RULE);
      this.append(`${chunk.join(',')}{${HIDE_DECLARATION}}`);
    }
    return fresh.length;
  }

  /** Appends `selector{style}` for a `:style()` filter. */
  style(selector: string, declarations: string): void {
    const key = `${selector}{${declarations}}`;
    if (this.injected.has(key)) return;
    this.injected.add(key);
    this.append(`${selector}{${declarations}}`);
  }

  /** Appends raw CSS text. */
  append(cssText: string): void {
    const el = this.element();
    if (!el) return;
    el.appendChild(this.doc.createTextNode(`\n${cssText}`));
  }

  /** True when the selector has already been injected. */
  has(selector: string): boolean {
    return this.injected.has(selector);
  }

  get cssText(): string {
    return this.el?.textContent ?? '';
  }

  destroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    this.observer = null;
    this.el?.remove();
    this.el = null;
    this.parent = null;
    this.injected.clear();
  }

  private observeParent(parent: Element): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.reattached > MAX_OBSERVED_REATTACH) return;
    const Observer = this.doc.defaultView?.MutationObserver;
    if (!Observer) return;
    this.observer = new Observer(() => {
      // Re-append if the page removed the element, and relocate into <head> once it exists.
      if (!this.destroyed) this.ensureAttached();
    });
    this.observer.observe(parent, { childList: true });
  }
}
