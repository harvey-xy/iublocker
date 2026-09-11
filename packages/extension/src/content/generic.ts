/**
 * Generic cosmetic filtering (`complete` mode only, docs/COSMETIC-FILTERING.md §3).
 *
 * Generic selectors are never injected wholesale: the engine harvests the ids and
 * classes that actually occur in the document — once at `DOMContentLoaded` and then
 * incrementally for added nodes / changed attributes — looks the tokens up in
 * `generic.byId` / `generic.byClass`, and appends only the selectors that can match.
 */

import type { CosmeticGeneric } from '@iublocker/shared';
import type { StyleManager } from './style';

export class GenericHider {
  private readonly generic: CosmeticGeneric;
  private readonly excluded: Set<string>;
  private readonly style: StyleManager;
  private readonly seenIds = new Set<string>();
  private readonly seenClasses = new Set<string>();
  private pending: string[] = [];
  private complexInjected = false;

  constructor(generic: CosmeticGeneric, excluded: readonly string[], style: StyleManager) {
    this.generic = generic;
    this.excluded = new Set(excluded);
    this.style = style;
  }

  /** Injects the non-simple generic selectors (once). */
  injectComplex(): void {
    if (this.complexInjected) return;
    this.complexInjected = true;
    const complex = this.generic.complex.filter((s) => !this.excluded.has(s));
    if (complex.length > 0) this.style.hide(complex);
  }

  /** Full scan of a root (used at `DOMContentLoaded`). */
  harvestRoot(root: ParentNode & Node): void {
    this.harvestNode(root);
  }

  /** Incremental scan of an added node and its subtree. */
  harvestNode(node: Node): void {
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
    if (node.nodeType === 1) this.harvestElement(node as Element);
    const parent = node as ParentNode;
    if (typeof parent.querySelectorAll !== 'function') return;
    let matches: ArrayLike<Element>;
    try {
      matches = parent.querySelectorAll('[id],[class]');
    } catch {
      return;
    }
    for (let i = 0; i < matches.length; i++) {
      const el = matches[i];
      if (el) this.harvestElement(el);
    }
  }

  /** Harvests one element's id and class tokens. */
  harvestElement(el: Element): void {
    const id = el.id;
    if (id && !this.seenIds.has(id)) {
      this.seenIds.add(id);
      this.collect(this.generic.byId[id]);
    }
    const classes = el.classList;
    for (let i = 0; i < classes.length; i++) {
      const token = classes[i];
      if (!token || this.seenClasses.has(token)) continue;
      this.seenClasses.add(token);
      this.collect(this.generic.byClass[token]);
    }
  }

  /** Number of collected selectors waiting for the next `flush()`. */
  get pendingCount(): number {
    return this.pending.length;
  }

  /** Appends everything collected since the last flush to the managed style element. */
  flush(): number {
    if (this.pending.length === 0) return 0;
    const batch = this.pending;
    this.pending = [];
    return this.style.hide(batch);
  }

  private collect(selectors: string[] | undefined): void {
    if (!selectors) return;
    for (const selector of selectors) {
      if (this.excluded.has(selector) || this.style.has(selector)) continue;
      this.pending.push(selector);
    }
  }
}
