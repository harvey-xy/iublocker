/**
 * Procedural operator chain parsing (docs/COSMETIC-FILTERING.md §1).
 *
 * A cosmetic selector is either "native" (pure CSS, injectable through a stylesheet)
 * or "procedural" (contains at least one uBO procedural pseudo-class and therefore has
 * to be evaluated by the content script as a chain of `ProceduralTask`s).
 */
import type { ProceduralFilter, ProceduralTask } from '@iublocker/shared';
import { scanSelector } from './selector';
import type { PseudoRef } from './selector';

/** Pseudo-classes and pseudo-elements we let through on the native path. */
export const NATIVE_PSEUDOS: ReadonlySet<string> = new Set([
  // structural / state
  'active',
  'any-link',
  'autofill',
  'blank',
  'checked',
  'current',
  'default',
  'defined',
  'dir',
  'disabled',
  'empty',
  'enabled',
  'first',
  'first-child',
  'first-of-type',
  'focus',
  'focus-visible',
  'focus-within',
  'fullscreen',
  'future',
  'has',
  'host',
  'host-context',
  'hover',
  'in-range',
  'indeterminate',
  'invalid',
  'is',
  'lang',
  'last-child',
  'last-of-type',
  'left',
  'link',
  'local-link',
  'modal',
  'not',
  'nth-child',
  'nth-col',
  'nth-last-child',
  'nth-last-col',
  'nth-last-of-type',
  'nth-of-type',
  'only-child',
  'only-of-type',
  'optional',
  'out-of-range',
  'past',
  'paused',
  'picture-in-picture',
  'placeholder-shown',
  'playing',
  'popover-open',
  'read-only',
  'read-write',
  'required',
  'right',
  'root',
  'scope',
  'target',
  'target-within',
  'user-invalid',
  'user-valid',
  'valid',
  'visited',
  'where',
  // pseudo-elements (single- and double-colon spellings)
  'after',
  'backdrop',
  'before',
  'cue',
  'file-selector-button',
  'first-letter',
  'first-line',
  'marker',
  'part',
  'placeholder',
  'selection',
  'slotted',
]);

/** Native pseudo-classes whose argument is itself a selector list. */
const NESTED_SELECTOR_PSEUDOS: ReadonlySet<string> = new Set(['has', 'not', 'is', 'where']);

/**
 * Alias → canonical operator name. `:if`/`:if-not` are the legacy ABP spellings of
 * `:has`/`:not`; `:matches` is the legacy spelling of `:is`.
 */
export const PSEUDO_ALIASES: ReadonlyMap<string, string> = new Map([
  ['contains', 'has-text'],
  ['-abp-contains', 'has-text'],
  ['-abp-has', 'has'],
  ['if', 'has'],
  ['if-not', 'not'],
  ['nth-ancestor', 'upward'],
  ['matches', 'is'],
]);

/** Operators that always force the procedural path. */
export const PROCEDURAL_OPS: ReadonlySet<string> = new Set([
  'has-text',
  'matches-css',
  'matches-css-before',
  'matches-css-after',
  'matches-attr',
  'matches-path',
  'matches-media',
  'min-text-length',
  'upward',
  'xpath',
  'watch-attr',
  'others',
  'remove',
  'style',
]);

/** Operators that are procedural only when their argument is procedural. */
const CONDITIONAL_OPS: ReadonlySet<string> = new Set(['has', 'not']);

export function canonicalPseudo(name: string): string {
  return PSEUDO_ALIASES.get(name) ?? name;
}

/** True when the selector contains at least one procedural operator (recursively). */
export function isProceduralSelector(sel: string): boolean {
  const res = scanSelector(sel);
  if (!res.ok) return false;
  for (const p of res.scan.pseudos) {
    const name = canonicalPseudo(p.name);
    if (PROCEDURAL_OPS.has(name)) return true;
    if (CONDITIONAL_OPS.has(name) && p.hasArg && isProceduralSelector(p.arg)) return true;
  }
  return false;
}

export type Ok<T> = { ok: true; value: T };
export type Err = { ok: false; reason: string };
export type Result<T> = Ok<T> | Err;

/**
 * Validate a pure-CSS selector and normalise legacy spellings (`:if` → `:has`,
 * `:-abp-has` → `:has`, `:matches` → `:is`).
 */
export function normalizeNativeSelector(sel: string): Result<string> {
  const trimmed = sel.trim();
  if (trimmed === '') return { ok: false, reason: 'empty selector' };
  const res = scanSelector(trimmed);
  if (!res.ok) return { ok: false, reason: res.reason };

  let out = trimmed;
  const pseudos = res.scan.pseudos;
  for (let k = pseudos.length - 1; k >= 0; k--) {
    const p = pseudos[k];
    if (p === undefined) continue;
    const name = canonicalPseudo(p.name);
    if (PROCEDURAL_OPS.has(name)) {
      return { ok: false, reason: `procedural operator ":${p.name}" in a plain selector` };
    }
    if (!NATIVE_PSEUDOS.has(name)) {
      return { ok: false, reason: `unknown pseudo-class ":${p.name}"` };
    }
    let arg = p.arg;
    if (p.hasArg && NESTED_SELECTOR_PSEUDOS.has(name)) {
      const nested = normalizeNativeSelector(p.arg);
      if (!nested.ok) return nested;
      arg = nested.value;
    }
    if (name !== p.name || arg !== p.arg) {
      const prefix = p.element ? '::' : ':';
      const replacement = p.hasArg ? `${prefix}${name}(${arg})` : `${prefix}${name}`;
      out = out.slice(0, p.start) + replacement + out.slice(p.end);
    }
  }
  return { ok: true, value: out };
}

export type ParsedSelector =
  | { procedural: false; css: string }
  | { procedural: true; tasks: ProceduralTask[] };

/**
 * Parse a cosmetic selector into either a validated plain CSS selector or a
 * procedural task chain.
 */
export function parseSelector(sel: string): Result<ParsedSelector> {
  const trimmed = sel.trim();
  if (trimmed === '') return { ok: false, reason: 'empty selector' };
  const res = scanSelector(trimmed);
  if (!res.ok) return { ok: false, reason: res.reason };

  const steps: PseudoRef[] = [];
  for (const p of res.scan.pseudos) {
    const name = canonicalPseudo(p.name);
    if (PROCEDURAL_OPS.has(name)) steps.push(p);
    else if (CONDITIONAL_OPS.has(name) && p.hasArg && isProceduralSelector(p.arg)) steps.push(p);
  }

  if (steps.length === 0) {
    const native = normalizeNativeSelector(trimmed);
    if (!native.ok) return native;
    return { ok: true, value: { procedural: false, css: native.value } };
  }

  if (res.scan.commas.length > 0) {
    return { ok: false, reason: 'selector list (",") is not allowed in a procedural filter' };
  }

  const tasks: ProceduralTask[] = [];
  let cursor = 0;
  for (const p of steps) {
    const chunk = trimmed.slice(cursor, p.start).trim();
    if (chunk !== '') {
      const native = normalizeNativeSelector(chunk);
      if (!native.ok) return native;
      tasks.push(['css', native.value]);
    }
    const task = buildTask(canonicalPseudo(p.name), p);
    if (!task.ok) return task;
    tasks.push(task.value);
    cursor = p.end;
  }
  const tail = trimmed.slice(cursor).trim();
  if (tail !== '') {
    const native = normalizeNativeSelector(tail);
    if (!native.ok) return native;
    tasks.push(['css', native.value]);
  }
  const head = tasks[0];
  if (head === undefined || head[0] !== 'css') tasks.unshift(['css', '*']);
  return { ok: true, value: { procedural: true, tasks } };
}

/** Parse a selector into a `ProceduralFilter` regardless of whether it needs one. */
export function parseProceduralFilter(sel: string): Result<ProceduralFilter> {
  const parsed = parseSelector(sel);
  if (!parsed.ok) return parsed;
  const raw = sel.trim();
  if (parsed.value.procedural) return { ok: true, value: { raw, tasks: parsed.value.tasks } };
  return { ok: true, value: { raw, tasks: [['css', parsed.value.css]] } };
}

function isDigits(s: string): boolean {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c < '0' || c > '9') return false;
  }
  return true;
}

const MAX_UPWARD = 256;

function buildTask(op: string, p: PseudoRef): Result<ProceduralTask> {
  const arg = p.arg.trim();
  switch (op) {
    case 'others':
    case 'remove':
      if (arg !== '') return { ok: false, reason: `":${op}()" takes no argument` };
      return { ok: true, value: op === 'others' ? ['others'] : ['remove'] };

    case 'has-text':
    case 'matches-css':
    case 'matches-css-before':
    case 'matches-css-after':
    case 'matches-attr':
    case 'matches-path':
    case 'matches-media':
    case 'xpath':
    case 'watch-attr':
    case 'style': {
      if (arg === '') return { ok: false, reason: `":${op}()" requires an argument` };
      return { ok: true, value: [op, arg] as ProceduralTask };
    }

    case 'min-text-length': {
      if (!isDigits(arg)) {
        return { ok: false, reason: '":min-text-length()" requires a non-negative integer' };
      }
      return { ok: true, value: ['min-text-length', Number(arg)] };
    }

    case 'upward': {
      if (arg === '') return { ok: false, reason: '":upward()" requires an argument' };
      if (isDigits(arg)) {
        const n = Number(arg);
        if (n < 1 || n > MAX_UPWARD) {
          return { ok: false, reason: `":upward()" depth out of range (1..${MAX_UPWARD})` };
        }
        return { ok: true, value: ['upward', n] };
      }
      const native = normalizeNativeSelector(arg);
      if (!native.ok) return native;
      return { ok: true, value: ['upward', native.value] };
    }

    case 'has':
    case 'not': {
      if (arg === '') return { ok: false, reason: `":${op}()" requires an argument` };
      const nested = parseProceduralFilter(arg);
      if (!nested.ok) return nested;
      return { ok: true, value: [op, nested.value] as ProceduralTask };
    }

    default:
      return { ok: false, reason: `unknown pseudo-class ":${p.name}"` };
  }
}
