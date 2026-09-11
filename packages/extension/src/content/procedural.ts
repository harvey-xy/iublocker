/**
 * Procedural filter executor (docs/COSMETIC-FILTERING.md §3).
 *
 * A `ProceduralFilter` is a chain of `ProceduralTask`s; each task maps a set of
 * elements to a new set. The last task may instead be an *action* (`remove`, `style`);
 * when there is none the matched elements are hidden with an important inline
 * `display:none`, and un-hidden when a later pass no longer matches them.
 *
 * Pure DOM code: it takes its environment as a parameter so it is unit-testable in jsdom.
 */

import type { ProceduralFilter, ProceduralTask } from '@iublocker/shared';
import { compileMatcher, inlineStyle, qsa, qsaScoped, splitKeyValue, parseStyleDeclarations } from './dom';
import type { Matcher } from './dom';

/** Set on every element the executor touches so re-runs are idempotent. */
export const MARKER_ATTR = 'data-iub';

export interface ProceduralEnv {
  doc: Document;
  getComputedStyle(el: Element, pseudo?: string | null): CSSStyleDeclaration;
  matchMedia(query: string): { matches: boolean };
  /** `location.pathname + location.search` of the frame. */
  path(): string;
}

export function envFromWindow(win: Window): ProceduralEnv {
  return {
    doc: win.document,
    getComputedStyle: (el, pseudo) => win.getComputedStyle(el, pseudo ?? null),
    matchMedia: (query) =>
      typeof win.matchMedia === 'function' ? win.matchMedia(query) : { matches: false },
    path: () => {
      try {
        return `${win.location.pathname}${win.location.search}`;
      } catch {
        return '';
      }
    },
  };
}

type ActionKind = 'hide' | 'remove' | 'style';

interface FilterState {
  filter: ProceduralFilter;
  /** Selection tasks (everything but a trailing action). */
  tasks: ProceduralTask[];
  action: ActionKind;
  styleText: string;
  watchAttrs: string[];
  watchAll: boolean;
  hidden: Set<Element>;
  /** Inline properties this filter set, with the value it replaced. */
  applied: Map<Element, Map<string, [value: string, priority: string]>>;
}

export interface ProceduralPassStats {
  hidden: number;
  unhidden: number;
  removed: number;
  styled: number;
}

type ActionTask = ['remove'] | ['style', string];

function isActionTask(task: ProceduralTask): task is ActionTask {
  return task[0] === 'remove' || task[0] === 'style';
}

function compile(filter: ProceduralFilter): FilterState {
  const tasks: ProceduralTask[] = [];
  let action: ActionKind = 'hide';
  let styleText = '';
  const watchAttrs: string[] = [];
  let watchAll = false;
  for (const task of filter.tasks) {
    if (isActionTask(task)) {
      if (task[0] === 'style') {
        action = 'style';
        styleText = task[1];
      } else {
        action = 'remove';
      }
      continue;
    }
    if (task[0] === 'watch-attr') {
      const names = task[1]
        .split(',')
        .map((n) => n.trim())
        .filter((n) => n.length > 0);
      if (names.length === 0) watchAll = true;
      else watchAttrs.push(...names);
    }
    tasks.push(task);
  }
  return {
    filter,
    tasks,
    action,
    styleText,
    watchAttrs,
    watchAll,
    hidden: new Set(),
    applied: new Map(),
  };
}

export class ProceduralExecutor {
  private readonly env: ProceduralEnv;
  private readonly states: FilterState[] = [];

  constructor(env: ProceduralEnv, filters: readonly ProceduralFilter[] = []) {
    this.env = env;
    this.add(filters);
  }

  add(filters: readonly ProceduralFilter[]): void {
    for (const filter of filters) {
      if (filter && Array.isArray(filter.tasks) && filter.tasks.length > 0) this.states.push(compile(filter));
    }
  }

  get size(): number {
    return this.states.length;
  }

  /** Attribute names that must be observed for `:watch-attr()`. */
  get watchedAttributes(): string[] {
    const out = new Set<string>();
    for (const state of this.states) for (const name of state.watchAttrs) out.add(name);
    return [...out];
  }

  /** True when a filter uses `:watch-attr()` without arguments (observe every attribute). */
  get watchesAllAttributes(): boolean {
    return this.states.some((s) => s.watchAll);
  }

  /** Evaluates one filter's selection chain. Exposed for tests. */
  select(filter: ProceduralFilter): Element[] {
    const state = compile(filter);
    return this.evaluate(state.tasks, null);
  }

  /** One evaluation pass over every filter. */
  run(): ProceduralPassStats {
    const stats: ProceduralPassStats = { hidden: 0, unhidden: 0, removed: 0, styled: 0 };
    for (const state of this.states) {
      let matched: Element[];
      try {
        matched = this.evaluate(state.tasks, null);
      } catch {
        continue;
      }
      if (state.action === 'remove') {
        for (const el of matched) {
          if (!el.isConnected) continue;
          el.remove();
          stats.removed += 1;
        }
        continue;
      }
      if (state.action === 'style') {
        stats.styled += this.applyStyle(state, matched);
        continue;
      }
      stats.hidden += this.hide(state, matched);
      stats.unhidden += this.unhideStale(state, matched);
    }
    return stats;
  }

  /** Reverts every inline change this executor made (teardown / mode change). */
  reset(): void {
    for (const state of this.states) {
      for (const el of state.hidden) this.restore(state, el);
      state.hidden.clear();
      for (const el of [...state.applied.keys()]) this.restore(state, el);
      state.applied.clear();
    }
  }

  // ---------------------------------------------------------------- selection

  private evaluate(tasks: readonly ProceduralTask[], input: Element[] | null): Element[] {
    let set: Element[] | null = input;
    for (const task of tasks) {
      if (set !== null && set.length === 0) return [];
      set = this.step(task, set);
    }
    return set === null ? [] : set;
  }

  private step(task: ProceduralTask, input: Element[] | null): Element[] {
    const doc = this.env.doc;
    switch (task[0]) {
      case 'css': {
        const selector = task[1];
        if (input === null) return qsa(doc, selector);
        return unique(input.flatMap((el) => qsaScoped(el, selector)));
      }
      case 'xpath': {
        const expr = task[1];
        if (input === null) return this.xpath(expr, doc);
        return unique(input.flatMap((el) => this.xpath(expr, el)));
      }
      default:
        break;
    }
    const set = input ?? qsa(doc, '*');
    switch (task[0]) {
      case 'has-text': {
        const match = compileMatcher(task[1], 'substring');
        return set.filter((el) => match(el.textContent ?? ''));
      }
      case 'min-text-length': {
        const min = Number(task[1]);
        return set.filter((el) => (el.textContent ?? '').length >= min);
      }
      case 'matches-css':
        return this.matchesCss(set, task[1], null);
      case 'matches-css-before':
        return this.matchesCss(set, task[1], '::before');
      case 'matches-css-after':
        return this.matchesCss(set, task[1], '::after');
      case 'matches-attr':
        return this.matchesAttr(set, task[1]);
      case 'matches-path': {
        const match = compileMatcher(task[1], 'substring');
        return match(this.env.path()) ? set : [];
      }
      case 'matches-media': {
        let matches = false;
        try {
          matches = this.env.matchMedia(task[1]).matches === true;
        } catch {
          matches = false;
        }
        return matches ? set : [];
      }
      case 'upward':
        return this.upward(set, task[1]);
      case 'watch-attr':
        return set;
      case 'others':
        return this.others(set);
      case 'has':
        return set.filter((el) => this.evaluateNested(task[1], el).length > 0);
      case 'not':
        return set.filter((el) => this.evaluateNested(task[1], el).length === 0);
      default:
        return set;
    }
  }

  /** `:has()` / `:not()` with a procedural argument: the chain is rooted at `el`. */
  private evaluateNested(filter: ProceduralFilter, el: Element): Element[] {
    const tasks = filter.tasks.filter((t) => !isActionTask(t));
    const first = tasks[0];
    const input = first && (first[0] === 'css' || first[0] === 'xpath') ? [el] : qsa(el, '*');
    return this.evaluate(tasks, input);
  }

  private xpath(expr: string, context: Node): Element[] {
    const doc = this.env.doc;
    const out: Element[] = [];
    try {
      const result = doc.evaluate(expr, context, null, 7 /* ORDERED_NODE_SNAPSHOT_TYPE */, null);
      for (let i = 0; i < result.snapshotLength; i++) {
        const node = result.snapshotItem(i);
        if (node && node.nodeType === 1) out.push(node as Element);
      }
    } catch {
      return [];
    }
    return out;
  }

  private matchesCss(set: Element[], arg: string, pseudo: string | null): Element[] {
    const [prop, rawValue] = splitKeyValue(arg);
    if (!prop || rawValue === null) return [];
    const match: Matcher = compileMatcher(rawValue, 'exact');
    return set.filter((el) => {
      let value = '';
      try {
        value = this.env.getComputedStyle(el, pseudo).getPropertyValue(prop).trim();
      } catch {
        return false;
      }
      return match(value);
    });
  }

  private matchesAttr(set: Element[], arg: string): Element[] {
    const [rawName, rawValue] = splitKeyValue(arg);
    if (!rawName) return [];
    const nameMatch = compileMatcher(rawName, 'exact');
    const valueMatch = rawValue === null ? null : compileMatcher(rawValue, 'exact');
    return set.filter((el) => {
      for (const attr of Array.from(el.attributes)) {
        if (!nameMatch(attr.name)) continue;
        if (valueMatch === null || valueMatch(attr.value)) return true;
      }
      return false;
    });
  }

  private upward(set: Element[], arg: number | string): Element[] {
    if (typeof arg === 'number' || /^\d+$/.test(String(arg).trim())) {
      const steps = typeof arg === 'number' ? arg : Number(String(arg).trim());
      if (!Number.isFinite(steps) || steps < 1 || steps > 256) return [];
      return unique(
        set
          .map((el) => {
            let node: Element | null = el;
            for (let i = 0; i < steps && node; i++) node = node.parentElement;
            return node;
          })
          .filter((el): el is Element => el !== null),
      );
    }
    const selector = String(arg);
    return unique(
      set
        .map((el) => {
          const parent = el.parentElement;
          if (!parent) return null;
          try {
            return parent.closest(selector);
          } catch {
            return null;
          }
        })
        .filter((el): el is Element => el !== null),
    );
  }

  /**
   * `:others()` — the minimal set of elements to hide so that only the matched
   * elements (and their ancestors) stay visible: every sibling along the path from
   * the document element down to each match.
   */
  private others(set: Element[]): Element[] {
    if (set.length === 0) return [];
    const keep = new Set<Element>();
    for (const el of set) {
      let node: Element | null = el;
      while (node) {
        keep.add(node);
        node = node.parentElement;
      }
    }
    const out: Element[] = [];
    const root = this.env.doc.documentElement;
    if (!root) return out;
    const stack: Element[] = [root];
    while (stack.length > 0) {
      const current = stack.pop() as Element;
      for (const child of Array.from(current.children)) {
        if (keep.has(child)) stack.push(child);
        else out.push(child);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ actions

  private hide(state: FilterState, matched: Element[]): number {
    let count = 0;
    for (const el of matched) {
      if (state.hidden.has(el)) continue;
      this.setProperty(state, el, 'display', 'none', 'important');
      el.setAttribute(MARKER_ATTR, 'hidden');
      state.hidden.add(el);
      count += 1;
    }
    return count;
  }

  private unhideStale(state: FilterState, matched: Element[]): number {
    if (state.hidden.size === 0) return 0;
    const current = new Set(matched);
    let count = 0;
    for (const el of [...state.hidden]) {
      if (current.has(el)) continue;
      state.hidden.delete(el);
      this.restore(state, el);
      count += 1;
    }
    return count;
  }

  private applyStyle(state: FilterState, matched: Element[]): number {
    const declarations = parseStyleDeclarations(state.styleText);
    if (declarations.length === 0) return 0;
    let count = 0;
    const current = new Set(matched);
    for (const el of matched) {
      if (state.applied.has(el)) continue;
      for (const { prop, value } of declarations) this.setProperty(state, el, prop, value, 'important');
      el.setAttribute(MARKER_ATTR, 'styled');
      count += 1;
    }
    for (const el of [...state.applied.keys()]) if (!current.has(el)) this.restore(state, el);
    return count;
  }

  /** Sets an important inline property, remembering what it replaced. */
  private setProperty(state: FilterState, el: Element, prop: string, value: string, priority: string): void {
    const style = inlineStyle(el);
    if (!style) return;
    let previous = state.applied.get(el);
    if (!previous) {
      previous = new Map();
      state.applied.set(el, previous);
    }
    if (!previous.has(prop)) {
      previous.set(prop, [style.getPropertyValue(prop), style.getPropertyPriority(prop)]);
    }
    style.setProperty(prop, value, priority);
  }

  /** Restores every inline property this filter changed on `el`. */
  private restore(state: FilterState, el: Element): void {
    const previous = state.applied.get(el);
    state.applied.delete(el);
    const style = inlineStyle(el);
    if (style && previous) {
      for (const [prop, [value, priority]] of previous) {
        if (value) style.setProperty(prop, value, priority);
        else style.removeProperty(prop);
      }
    }
    if (el.getAttribute(MARKER_ATTR) !== null) el.removeAttribute(MARKER_ATTR);
  }
}

function unique(list: Element[]): Element[] {
  if (list.length < 2) return list;
  return [...new Set(list)];
}
