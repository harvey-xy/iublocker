/**
 * Line classifier. docs/FILTER-SYNTAX.md §1.
 *
 * Splits a raw filter list into network / cosmetic / scriptlet / HTML buckets, captures
 * list metadata from `! Key: value` comments, honours `!#if` / `!#else` / `!#endif`
 * pre-processor directives and understands hosts-file syntax.
 *
 * Isomorphic: no Node built-ins, no regex on the per-line hot path.
 */
import type { ClassifiedList, ListMeta, RawLine } from '../types';

export interface ClassifyOptions {
  /** Environment used to evaluate `!#if` directives. Default 'chromium'. */
  env?: 'chromium';
  /** 'hosts' forces hosts-file parsing; 'abp' disables bare-hostname lines. Default: auto. */
  format?: 'abp' | 'hosts';
}

/** Cosmetic separators, longest first so `#@$?#` wins over `#@`. */
const COSMETIC_SEPARATORS = ['#@$?#', '#@?#', '#@$#', '#@%#', '#$?#', '#@#', '#?#', '#$#', '#%#', '##'];

/** Hosts-file redirect targets we accept as "blocked". */
const HOSTS_IPS = new Set(['0.0.0.0', '127.0.0.1', '::1', '::', '255.255.255.255']);

/** Hostnames that appear in every hosts file and never mean "block this". */
const HOSTS_IGNORED = new Set([
  'localhost',
  'localhost.localdomain',
  'local',
  'broadcasthost',
  'ip6-localhost',
  'ip6-loopback',
  'ip6-localnet',
  'ip6-mcastprefix',
  'ip6-allnodes',
  'ip6-allrouters',
  'ip6-allhosts',
  '0.0.0.0',
]);

/** Characters allowed in the domain part that precedes a cosmetic separator. */
function isDomainListChar(c: string): boolean {
  return (
    (c >= 'a' && c <= 'z') ||
    (c >= 'A' && c <= 'Z') ||
    (c >= '0' && c <= '9') ||
    c === '.' ||
    c === '-' ||
    c === '_' ||
    c === '*' ||
    c === '~' ||
    c === ',' ||
    c === '[' ||
    c === ']' ||
    c === ':' ||
    c === '/' ||
    c.charCodeAt(0) > 127
  );
}

export interface CosmeticSeparatorMatch {
  index: number;
  sep: string;
}

/**
 * Find the cosmetic separator in a line, or null when the line is a network filter.
 * Guarded by the domain-list charset so `||example.com/a#b` stays a network filter.
 */
export function findCosmeticSeparator(line: string): CosmeticSeparatorMatch | null {
  for (let i = line.indexOf('#'); i !== -1; i = line.indexOf('#', i + 1)) {
    for (const sep of COSMETIC_SEPARATORS) {
      if (line.startsWith(sep, i)) {
        for (let j = 0; j < i; j += 1) {
          const c = line[j];
          if (c === undefined || !isDomainListChar(c)) return null;
        }
        return { index: i, sep };
      }
    }
  }
  return null;
}

const META_KEYS: Record<string, keyof ListMeta> = {
  title: 'title',
  version: 'version',
  expires: 'expires',
  homepage: 'homepage',
  'last modified': 'lastModified',
  'last-modified': 'lastModified',
  lastmodified: 'lastModified',
  'last updated': 'lastModified',
  license: 'license',
  licence: 'license',
};

function captureMeta(meta: ListMeta, comment: string): void {
  const colon = comment.indexOf(':');
  if (colon <= 0) return;
  const key = comment.slice(0, colon).trim().toLowerCase();
  const field = META_KEYS[key];
  if (field === undefined) return;
  const value = comment.slice(colon + 1).trim();
  if (value !== '' && meta[field] === undefined) meta[field] = value;
}

/**
 * Identifiers that are true for the Chromium MV3 build.
 *
 * `adguard_ext_chromium_mv3` matters far more than it looks: AdGuard's lists gate their
 * huge CNAME-tracker sections on `!adguard_ext_chromium_mv3` precisely because an MV3
 * extension cannot afford them inside the 330,000-rule budget (AdGuard Spyware alone
 * carries ~210,000 such lines), and they gate MV3-adapted replacements on the positive
 * form. We are exactly the platform that token describes, so claiming it is both correct
 * and what keeps the list inside `BUILD_BUDGET.STATIC_RULES_PER_LIST`.
 */
const TRUE_TOKENS = new Set([
  'env_chromium',
  'env_chrome',
  'env_mv3',
  'ext_ublock',
  'ublock',
  'cap_user_stylesheet',
  'adguard_ext_chromium_mv3',
]);

/** Evaluate a `!#if` expression (`!`, `&&`, `||`, parentheses, identifiers, `env=chromium`). */
export function evaluateIfExpression(expr: string, env: string): boolean {
  let pos = 0;
  const src = expr;

  const skipSpace = (): void => {
    while (pos < src.length && (src[pos] === ' ' || src[pos] === '\t')) pos += 1;
  };

  const parseAtom = (): boolean => {
    skipSpace();
    if (src[pos] === '!') {
      pos += 1;
      return !parseAtom();
    }
    if (src[pos] === '(') {
      pos += 1;
      const v = parseOr();
      skipSpace();
      if (src[pos] === ')') pos += 1;
      return v;
    }
    const start = pos;
    while (pos < src.length) {
      const c = src[pos] as string;
      if (c === ' ' || c === '\t' || c === ')' || c === '&' || c === '|' || c === '!') break;
      pos += 1;
    }
    const token = src.slice(start, pos).toLowerCase();
    if (token === '') return false;
    const eq = token.indexOf('=');
    if (eq !== -1) {
      const name = token.slice(0, eq);
      const value = token.slice(eq + 1);
      if (name === 'env' || name === 'environment') return value === env;
      return false;
    }
    if (token === 'true') return true;
    if (token === 'false') return false;
    return TRUE_TOKENS.has(token);
  };

  const parseAnd = (): boolean => {
    let v = parseAtom();
    for (;;) {
      skipSpace();
      if (src.startsWith('&&', pos)) {
        pos += 2;
        const rhs = parseAtom();
        v = v && rhs;
      } else break;
    }
    return v;
  };

  function parseOr(): boolean {
    let v = parseAnd();
    for (;;) {
      skipSpace();
      if (src.startsWith('||', pos)) {
        pos += 2;
        const rhs = parseAnd();
        v = v || rhs;
      } else break;
    }
    return v;
  }

  return parseOr();
}

/**
 * Parse a hosts-file line into its hostnames, or null when it is not one.
 * A recognised hosts line with nothing but `localhost`-style entries returns `[]`, so the
 * caller still consumes it instead of falling through to the network parser.
 */
export function parseHostsLine(line: string, allowBare: boolean): string[] | null {
  const hash = line.indexOf('#');
  const body = (hash === -1 ? line : line.slice(0, hash)).trim();
  if (body === '') return null;
  const parts = body.split(/[ \t]+/);
  const first = parts[0];
  if (first === undefined) return null;
  let hosts: string[];
  let strict = false;
  if (HOSTS_IPS.has(first)) {
    hosts = parts.slice(1);
  } else if (allowBare && parts.length === 1) {
    hosts = parts;
    strict = true;
  } else {
    return null;
  }
  const out: string[] = [];
  for (const h of hosts) {
    const host = h.toLowerCase();
    if (host === '' || HOSTS_IGNORED.has(host)) continue;
    if (!isPlainHostname(host)) {
      if (strict) return null;
      continue;
    }
    out.push(host);
  }
  return strict && out.length === 0 ? null : out;
}

/** A hostname made only of label chars — no wildcards, anchors, paths or options. */
export function isPlainHostname(h: string): boolean {
  if (h.length === 0 || h.length > 253) return false;
  let dots = 0;
  for (let i = 0; i < h.length; i += 1) {
    const c = h[i] as string;
    if (c === '.') {
      dots += 1;
      if (i === 0 || h[i - 1] === '.') return false;
      continue;
    }
    const ok =
      (c >= 'a' && c <= 'z') ||
      (c >= 'A' && c <= 'Z') ||
      (c >= '0' && c <= '9') ||
      c === '-' ||
      c === '_' ||
      c.charCodeAt(0) > 127;
    if (!ok) return false;
  }
  return dots > 0 && h[h.length - 1] !== '.';
}

interface IfFrame {
  /** Whether lines in the current branch are emitted. */
  active: boolean;
  /** Whether a branch of this if/else has already been taken. */
  taken: boolean;
  /** Whether the enclosing scope was active at all. */
  parentActive: boolean;
}

/**
 * Classify every line of a filter list.
 *
 * `!#include` is ignored (tools/fetch-lists expands includes); `!#if` / `!#else` /
 * `!#endif` are honoured against `opts.env` (default 'chromium').
 */
export function classifyLines(text: string, opts: ClassifyOptions = {}): ClassifiedList {
  const env = opts.env ?? 'chromium';
  const meta: ListMeta = {};
  const network: RawLine[] = [];
  const cosmetic: RawLine[] = [];
  const scriptlet: RawLine[] = [];
  const html: RawLine[] = [];
  let comments = 0;

  const hostsForced = opts.format === 'hosts';
  const hostsAllowed = opts.format !== 'abp';
  const stack: IfFrame[] = [];
  const isActive = (): boolean => stack.length === 0 || (stack[stack.length - 1] as IfFrame).active;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    let raw = lines[i] as string;
    if (raw.charCodeAt(raw.length - 1) === 13) raw = raw.slice(0, -1);
    const trimmed = raw.trim();
    const lineNo = i + 1;
    if (trimmed === '') continue;

    // Pre-processor directives are evaluated even inside an inactive branch (nesting).
    if (trimmed.charCodeAt(0) === 33 /* ! */ && trimmed.charCodeAt(1) === 35 /* # */) {
      comments += 1;
      const directive = trimmed.slice(2);
      const space = directive.search(/[ \t]/);
      const name = (space === -1 ? directive : directive.slice(0, space)).toLowerCase();
      const rest = space === -1 ? '' : directive.slice(space + 1).trim();
      if (name === 'if') {
        const parentActive = isActive();
        const value = parentActive && evaluateIfExpression(rest, env);
        stack.push({ active: value, taken: value, parentActive });
      } else if (name === 'else') {
        const frame = stack[stack.length - 1];
        if (frame !== undefined) {
          frame.active = frame.parentActive && !frame.taken;
          frame.taken = frame.taken || frame.active;
        }
      } else if (name === 'endif') {
        stack.pop();
      }
      continue;
    }

    if (!isActive()) continue;

    if (trimmed.charCodeAt(0) === 33 /* ! */) {
      comments += 1;
      captureMeta(meta, trimmed.slice(1).trim());
      continue;
    }
    if (trimmed.charCodeAt(0) === 91 /* [ */) {
      comments += 1;
      continue;
    }
    if (trimmed.charCodeAt(0) === 35 /* # */ && trimmed.charCodeAt(1) !== 35) {
      // `# comment` in hosts files; `##selector` is cosmetic and handled below.
      const sep = findCosmeticSeparator(trimmed);
      if (sep === null || sep.index !== 0) {
        comments += 1;
        continue;
      }
    }

    const sep = findCosmeticSeparator(trimmed);
    if (sep === null) {
      if (hostsAllowed) {
        const hosts = parseHostsLine(trimmed, hostsForced);
        if (hosts !== null) {
          for (const host of hosts) network.push({ line: lineNo, raw: `||${host}^` });
          continue;
        }
      }
      network.push({ line: lineNo, raw: trimmed });
      continue;
    }

    const body = trimmed.slice(sep.index + sep.sep.length);
    const entry: RawLine = { line: lineNo, raw: trimmed };
    if (sep.sep === '#%#' || sep.sep === '#@%#') {
      if (body.startsWith('//scriptlet')) scriptlet.push(entry);
      else html.push(entry); // AdGuard raw JS — not supported (no remote code).
      continue;
    }
    if (body.startsWith('+js(')) {
      scriptlet.push(entry);
      continue;
    }
    if (body.startsWith('^')) {
      html.push(entry);
      continue;
    }
    cosmetic.push(entry);
  }

  return { meta, network, cosmetic, scriptlet, html, comments };
}
