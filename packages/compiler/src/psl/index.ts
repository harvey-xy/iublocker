/**
 * Public-suffix helpers for entity (`example.*`) expansion.
 * docs/FILTER-SYNTAX.md §2.2, docs/COSMETIC-FILTERING.md §1.
 */
import { hostnameWalk } from '@iublocker/shared';
import { PUBLIC_SUFFIXES, isPublicSuffix } from './suffixes';

export { PUBLIC_SUFFIXES, isPublicSuffix };

/** Hard cap on how many hostnames one entity may expand to. */
export const ENTITY_EXPANSION_LIMIT = 300;

/** `example.*` → true. */
export function isEntity(domain: string): boolean {
  return domain.endsWith('.*');
}

/** `example.*` → `example`. */
export function entityBase(domain: string): string {
  return domain.slice(0, -2);
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
 * most common public suffixes. Always capped at `limit` (default 300).
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
