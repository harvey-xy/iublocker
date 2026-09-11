/**
 * Cosmetic filter line parser (docs/COSMETIC-FILTERING.md §1).
 *
 * Handles the uBO separators (`##`, `#@#`, `#?#`, `#@?#`) and the AdGuard CSS-injection
 * separators (`#$#`, `#@$#`, `#$?#`, `#@$?#`). AdGuard `#$#selector { css }` is treated
 * exactly like uBO's `:style()`.
 */
import type { ProceduralFilter, ProceduralTask } from '@iublocker/shared';
import { isValidHostname } from '@iublocker/shared';
import { parseSelector } from './procedural';
import { isEntity } from './entities';

/** Cosmetic separators, longest first so `#@?#` wins over `#@#`-like prefixes. */
const SEPARATORS = ['#@$?#', '#@?#', '#@$#', '#$?#', '#@#', '#$#', '#?#', '##'] as const;

export type CosmeticSeparator = (typeof SEPARATORS)[number];

export interface DomainList {
  /** Positive hostnames and entities (`example.*`), lower-cased. */
  include: string[];
  /** Negated hostnames and entities, lower-cased, without the leading `~`. */
  exclude: string[];
}

export interface SplitCosmetic {
  domains: string;
  separator: CosmeticSeparator;
  body: string;
}

/** Split a raw line into its domain prefix, separator and body. Returns null when the
 *  line is not a cosmetic filter at all. */
export function splitCosmetic(raw: string): SplitCosmetic | null {
  for (let i = 0; i < raw.length; i++) {
    if (raw.charAt(i) !== '#') continue;
    for (const sep of SEPARATORS) {
      if (raw.startsWith(sep, i)) {
        return { domains: raw.slice(0, i), separator: sep, body: raw.slice(i + sep.length) };
      }
    }
    // A `#` that starts no known separator (e.g. AdGuard `#%#`): not a cosmetic filter.
    return null;
  }
  return null;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Parse a comma-separated domain list with `~` negations and `example.*` entities. */
export function parseDomainList(text: string): ParseResult<DomainList> {
  const include: string[] = [];
  const exclude: string[] = [];
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: { include, exclude } };
  for (const part of trimmed.split(',')) {
    let entry = part.trim().toLowerCase();
    if (entry === '') return { ok: false, reason: 'empty entry in domain list' };
    let negated = false;
    if (entry.charAt(0) === '~') {
      negated = true;
      entry = entry.slice(1).trim();
    }
    if (entry === '') return { ok: false, reason: 'empty entry in domain list' };
    if (entry.charAt(0) === '/') {
      return { ok: false, reason: 'regex domains are not supported in cosmetic filters' };
    }
    const host = isEntity(entry) ? entry.slice(0, -2) : entry;
    if (host === '' || !isValidHostname(host)) {
      return { ok: false, reason: `invalid hostname "${entry}"` };
    }
    (negated ? exclude : include).push(entry);
  }
  return { ok: true, value: { include, exclude } };
}

export type CosmeticForm =
  /** Plain CSS selector: element hiding. */
  | { form: 'plain'; selector: string }
  /** `:style()` / AdGuard `#$#sel { css }`. */
  | { form: 'style'; selector: string; style: string }
  /** Procedural chain, evaluated by the content script. */
  | { form: 'procedural'; filter: ProceduralFilter };

export interface ParsedCosmetic {
  separator: CosmeticSeparator;
  domains: DomainList;
  exception: boolean;
  body: CosmeticForm;
  /** The body text exactly as written (used as the exception key). */
  rawBody: string;
}

function isExceptionSeparator(sep: CosmeticSeparator): boolean {
  return sep === '#@#' || sep === '#@?#' || sep === '#@$#' || sep === '#@$?#';
}

function isStyleSeparator(sep: CosmeticSeparator): boolean {
  return sep === '#$#' || sep === '#@$#' || sep === '#$?#' || sep === '#@$?#';
}

/** Split an AdGuard `selector { declarations }` body. */
function splitAdGuardStyle(body: string): ParseResult<{ selector: string; style: string }> {
  const open = body.indexOf('{');
  const close = body.lastIndexOf('}');
  if (open === -1 || close === -1 || close < open) {
    return { ok: false, reason: 'AdGuard "#$#" body must be "selector { declarations }"' };
  }
  if (body.slice(close + 1).trim() !== '') {
    return { ok: false, reason: 'trailing text after "}" in "#$#" body' };
  }
  const selector = body.slice(0, open).trim();
  const style = body.slice(open + 1, close).trim();
  if (selector === '') return { ok: false, reason: 'empty selector in "#$#" body' };
  if (style === '') return { ok: false, reason: 'empty declarations in "#$#" body' };
  return { ok: true, value: { selector, style } };
}

/**
 * Parse one cosmetic filter line.
 *
 * Returns `{ ok: false, reason }` for a malformed cosmetic filter, and `null` for a line
 * that is not a cosmetic filter (comment, scriptlet, network filter) and should simply be
 * skipped by the caller.
 */
export function parseCosmeticFilter(raw: string): ParseResult<ParsedCosmetic> | null {
  const line = raw.trim();
  if (line === '' || line.charAt(0) === '!' || line.charAt(0) === '[') return null;

  const split = splitCosmetic(line);
  if (split === null) return null;
  const { domains: domainText, separator, body: rawBody } = split;

  // Scriptlet filters belong to the scriptlet compiler.
  if (rawBody.startsWith('+js(')) return null;
  // HTML filtering is not expressible under MV3 (docs/ARCHITECTURE.md §1).
  if (rawBody.startsWith('^')) {
    return { ok: false, reason: 'HTML filtering ("##^") is not supported under MV3' };
  }
  if (rawBody.trim() === '') return { ok: false, reason: 'empty cosmetic filter body' };

  const domains = parseDomainList(domainText);
  if (!domains.ok) return domains;

  const exception = isExceptionSeparator(separator);

  if (isStyleSeparator(separator)) {
    const parts = splitAdGuardStyle(rawBody);
    if (!parts.ok) return parts;
    const parsed = parseSelector(parts.value.selector);
    if (!parsed.ok) return parsed;
    if (parsed.value.procedural) {
      const tasks: ProceduralTask[] = [...parsed.value.tasks, ['style', parts.value.style]];
      return {
        ok: true,
        value: {
          separator,
          domains: domains.value,
          exception,
          rawBody: rawBody.trim(),
          body: { form: 'procedural', filter: { raw: rawBody.trim(), tasks } },
        },
      };
    }
    return {
      ok: true,
      value: {
        separator,
        domains: domains.value,
        exception,
        rawBody: rawBody.trim(),
        body: { form: 'style', selector: parsed.value.css, style: parts.value.style },
      },
    };
  }

  const parsed = parseSelector(rawBody);
  if (!parsed.ok) return parsed;

  if (!parsed.value.procedural) {
    return {
      ok: true,
      value: {
        separator,
        domains: domains.value,
        exception,
        rawBody: rawBody.trim(),
        body: { form: 'plain', selector: parsed.value.css },
      },
    };
  }

  const tasks = parsed.value.tasks;
  // `sel:style(css)` with an otherwise plain selector is a stylesheet rule, not a
  // content-script task chain.
  const first = tasks[0];
  const second = tasks[1];
  if (
    tasks.length === 2 &&
    first !== undefined &&
    second !== undefined &&
    first[0] === 'css' &&
    second[0] === 'style'
  ) {
    return {
      ok: true,
      value: {
        separator,
        domains: domains.value,
        exception,
        rawBody: rawBody.trim(),
        body: { form: 'style', selector: first[1], style: second[1] },
      },
    };
  }

  return {
    ok: true,
    value: {
      separator,
      domains: domains.value,
      exception,
      rawBody: rawBody.trim(),
      body: { form: 'procedural', filter: { raw: rawBody.trim(), tasks } },
    },
  };
}
