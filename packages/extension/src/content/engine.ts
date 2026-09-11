/**
 * The cosmetic engine (ISOLATED world, `document_start`, all frames).
 * docs/COSMETIC-FILTERING.md §3, docs/ARCHITECTURE.md §4 step 4.
 *
 * Flow: ask the worker for this frame's cosmetic payload → bail out when the site mode
 * is below `optimal` or `$elemhide` applies → apply the (rare) content-script selectors
 * and `:style()` rules → generic hiding by DOM harvest (`complete` mode) → procedural
 * filters, re-evaluated on batched mutations → collapse blocked media.
 */

import type { CosmeticGetResponse } from '@iublocker/shared';
import { modeAtLeast, sendRequest } from '@iublocker/shared';
import { frameHostname, topHostname } from './dom';
import { StyleManager } from './style';
import { GenericHider } from './generic';
import { ProceduralExecutor, envFromWindow } from './procedural';
import { Collapser } from './collapse';
import { Scheduler } from './scheduler';

const PROCEDURAL_MIN_INTERVAL_MS = 100;
const IDLE_TIMEOUT_MS = 250;

export class CosmeticEngine {
  readonly response: CosmeticGetResponse;
  private readonly win: Window;
  private readonly doc: Document;
  private readonly style: StyleManager;
  private readonly generic: GenericHider | null;
  private readonly procedural: ProceduralExecutor | null;
  private readonly collapser: Collapser | null;
  private readonly scheduler: Scheduler;
  private observer: MutationObserver | null = null;
  private deferredWhileHidden = false;
  private stopped = false;
  private readonly onReady = (): void => this.onDomReady();
  private readonly onVisibility = (): void => {
    if (!this.doc.hidden && this.deferredWhileHidden) this.scheduler.flush();
  };

  constructor(win: Window, response: CosmeticGetResponse) {
    this.win = win;
    this.doc = win.document;
    this.response = response;
    this.style = new StyleManager(this.doc);
    this.generic = response.generic
      ? new GenericHider(response.generic, response.excluded, this.style)
      : null;
    const procedural =
      response.procedural.length > 0 ? new ProceduralExecutor(envFromWindow(win), response.procedural) : null;
    this.procedural = procedural && procedural.size > 0 ? procedural : null;
    this.collapser = new Collapser(win);
    this.scheduler = new Scheduler(win, () => this.pass(), {
      minInterval: PROCEDURAL_MIN_INTERVAL_MS,
      timeout: IDLE_TIMEOUT_MS,
    });
  }

  start(): void {
    this.applyStatic();
    this.generic?.injectComplex();
    this.collapser?.start();
    this.observe();
    if (this.doc.readyState === 'loading') {
      this.doc.addEventListener('DOMContentLoaded', this.onReady, { once: true });
    } else {
      this.onDomReady();
    }
    this.doc.addEventListener('visibilitychange', this.onVisibility);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.observer?.disconnect();
    this.observer = null;
    this.scheduler.stop();
    this.collapser?.stop();
    this.procedural?.reset();
    this.doc.removeEventListener('DOMContentLoaded', this.onReady);
    this.doc.removeEventListener('visibilitychange', this.onVisibility);
    this.style.destroy();
  }

  /** Runs one full pass now (tests, and `DOMContentLoaded`). */
  pass(): void {
    if (this.stopped) return;
    if (this.doc.hidden) {
      this.deferredWhileHidden = true;
      return;
    }
    this.deferredWhileHidden = false;
    this.style.ensureAttached();
    this.generic?.flush();
    this.procedural?.run();
  }

  /** The CSS currently in the managed style element (tests). */
  get cssText(): string {
    return this.style.cssText;
  }

  private applyStatic(): void {
    const { selectors, styles } = this.response;
    if (selectors.length > 0) this.style.hide(selectors);
    for (const entry of styles) {
      const selector = entry[0];
      const declarations = entry[1];
      if (selector && declarations) this.style.style(selector, declarations);
    }
  }

  private onDomReady(): void {
    if (this.stopped) return;
    this.style.ensureAttached();
    const root = this.doc.documentElement;
    if (this.generic && root) this.generic.harvestRoot(root);
    this.pass();
  }

  private observe(): void {
    const needsMutations = this.generic !== null || this.procedural !== null;
    if (!needsMutations) return;
    const Observer = this.doc.defaultView?.MutationObserver;
    if (!Observer) return;
    const attributeFilter = new Set<string>();
    if (this.generic) {
      attributeFilter.add('class');
      attributeFilter.add('id');
    }
    let watchAll = false;
    if (this.procedural) {
      watchAll = this.procedural.watchesAllAttributes;
      for (const name of this.procedural.watchedAttributes) attributeFilter.add(name);
    }
    const observeAttributes = watchAll || attributeFilter.size > 0;
    const observer = new Observer((records: MutationRecord[]) => this.onMutations(records));
    const init: MutationObserverInit = { childList: true, subtree: true, attributes: observeAttributes };
    if (observeAttributes && !watchAll) init.attributeFilter = [...attributeFilter];
    const root: Node = this.doc.documentElement ?? this.doc;
    try {
      observer.observe(root, init);
      this.observer = observer;
    } catch {
      this.observer = null;
    }
  }

  private onMutations(records: MutationRecord[]): void {
    if (this.stopped) return;
    const generic = this.generic;
    for (const record of records) {
      if (record.type === 'childList') {
        if (generic) {
          const added = record.addedNodes;
          for (let i = 0; i < added.length; i++) {
            const node = added[i];
            if (node) generic.harvestNode(node);
          }
        }
      } else if (record.type === 'attributes' && generic) {
        const target = record.target;
        if (target.nodeType === 1) generic.harvestElement(target as Element);
      }
    }
    this.scheduler.schedule();
  }
}

/**
 * Entry path: resolve this frame's hostname, ask the worker, and start the engine.
 * Resolves to `null` when cosmetic filtering is off for this frame.
 */
export async function startEngine(win: Window): Promise<CosmeticEngine | null> {
  const hostname = frameHostname(win);
  let response: CosmeticGetResponse;
  try {
    response = await sendRequest({
      type: 'cosmetic:get',
      hostname,
      topHostname: topHostname(win),
      // The worker uses `sender.frameId`; this field only keeps the request shape whole.
      frameId: 0,
    });
  } catch {
    return null;
  }
  if (!response || !modeAtLeast(response.mode, 'optimal') || response.elemhide) return null;
  const engine = new CosmeticEngine(win, {
    ...response,
    procedural: response.procedural ?? [],
    selectors: response.selectors ?? [],
    styles: response.styles ?? [],
    excluded: response.excluded ?? [],
  });
  engine.start();
  return engine;
}
