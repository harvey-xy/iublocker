/**
 * Public-suffix helpers for filter *entities* (`example.*`).
 *
 * This is the project's only public-suffix snapshot: the network compiler expands
 * entities into concrete `initiatorDomains`/`requestDomains` (DNR has no entity concept),
 * while the cosmetic and scriptlet compilers keep the entity key verbatim and resolve it
 * at lookup time with {@link entityKeysFor}.
 *
 * docs/FILTER-SYNTAX.md §2.2, docs/COSMETIC-FILTERING.md §2, docs/SCRIPTLETS.md §2.
 */
import { hostnameWalk } from '@iublocker/shared';
import { PUBLIC_SUFFIXES, isPublicSuffix } from './suffixes';

export { PUBLIC_SUFFIXES, isPublicSuffix };

/** Literal suffix that marks an entity key (`example.*`). */
export const ENTITY_SUFFIX = '.*';

/**
 * Hard cap on how many hostnames one entity may expand to for NETWORK rules.
 *
 * Only the network compiler expands at all, and it prefers hostnames that actually occur
 * in the list, so the fallback only matters for entities the list never spells out.
 */
export const ENTITY_EXPANSION_LIMIT = 100;

/** `example.*` → true. */
export function isEntity(domain: string): boolean {
  return domain.endsWith(ENTITY_SUFFIX);
}

/** `example.*` → `example`. */
export function entityBase(domain: string): string {
  return domain.slice(0, -2);
}

/** `example` → `example.*`. */
export function entityKey(base: string): string {
  return `${base}${ENTITY_SUFFIX}`;
}

/**
 * The public suffix of a hostname according to the snapshot, or '' when unknown.
 * Longest match wins, so `a.co.uk` → `co.uk` rather than `uk`.
 */
export function publicSuffixOf(hostname: string): string {
  const parts = hostnameWalk(hostname);
  for (const candidate of parts) {
    if (candidate !== hostname && isPublicSuffix(candidate)) return candidate;
  }
  return '';
}

/**
 * Entity keys a hostname may match, most specific first.
 *
 * `a.b.example.co.uk` → `['a.b.example.*', 'b.example.*', 'example.*']`: every label
 * prefix above the public suffix. This is the lookup-time counterpart of compile-time
 * entity expansion — the cosmetic and scriptlet DBs store `example.*` verbatim instead of
 * exploding it into hundreds of concrete hostnames (docs/COSMETIC-FILTERING.md §2).
 *
 * Returns `[]` when the hostname is itself a public suffix (`co.uk` is not `co.*`) or when
 * its public suffix is unknown (an IP literal, `localhost`, an unlisted TLD).
 */
export function entityKeysFor(hostname: string): string[] {
  // A bare public suffix is not an entity: `co.uk` must not yield `co.*`.
  if (isPublicSuffix(hostname)) return [];
  const suffix = publicSuffixOf(hostname);
  if (suffix === '') return [];
  let head = hostname.slice(0, hostname.length - suffix.length - 1);
  if (head === '') return [];
  const out: string[] = [];
  for (;;) {
    out.push(head + ENTITY_SUFFIX);
    const dot = head.indexOf('.');
    if (dot === -1) break;
    head = head.slice(dot + 1);
  }
  return out;
}

export interface ExpandEntityOptions {
  /**
   * Hostnames seen elsewhere in the same list. When any of them match the entity the
   * expansion is restricted to those, which keeps rules small and precise.
   */
  known?: ReadonlySet<string>;
  limit?: number;
}

/**
 * Expand `example.*` into concrete hostnames.
 *
 * Prefers hostnames that actually occur in the list (`opts.known`); falls back to the
 * most common public suffixes. Always capped at `limit` (default
 * {@link ENTITY_EXPANSION_LIMIT}).
 */
export function expandEntity(base: string, opts: ExpandEntityOptions = {}): string[] {
  const limit = opts.limit ?? ENTITY_EXPANSION_LIMIT;
  if (base === '' || limit <= 0) return [];
  const prefix = `${base}.`;
  const out: string[] = [];

  if (opts.known !== undefined && opts.known.size > 0) {
    for (const host of opts.known) {
      if (!host.startsWith(prefix)) continue;
      const suffix = host.slice(prefix.length);
      if (suffix === '' || !isPublicSuffix(suffix)) continue;
      out.push(host);
      if (out.length >= limit) break;
    }
    if (out.length > 0) return out.sort();
  }

  for (const suffix of PUBLIC_SUFFIXES) {
    out.push(prefix + suffix);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Expand a mixed list of domains and entities. Non-entities pass through unchanged.
 * The result is deduped and sorted so rules canonicalise (docs/FILTER-SYNTAX.md §5.2).
 */
export function expandDomains(domains: readonly string[], opts: ExpandEntityOptions = {}): string[] {
  const out = new Set<string>();
  for (const d of domains) {
    if (isEntity(d)) for (const h of expandEntity(entityBase(d), opts)) out.add(h);
    else out.add(d);
  }
  return [...out].sort();
}
