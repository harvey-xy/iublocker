/**
 * Entity (`example.*`) helpers for cosmetic and scriptlet filters.
 *
 * There is exactly one public-suffix snapshot in the compiler (`src/psl`); this module is
 * the cosmetic-side view of it and keeps the names T2 already imports.
 *
 * Cosmetic and scriptlet filters are **not** expanded at compile time any more: an entity
 * is stored verbatim as the hostname key `example.*` and resolved on lookup with
 * {@link entityKeysFor} (docs/COSMETIC-FILTERING.md §2, docs/SCRIPTLETS.md §2). Expansion
 * survives only for network rules, where DNR needs concrete domains.
 */
import { ENTITY_EXPANSION_LIMIT, PUBLIC_SUFFIXES, entityKeysFor, isEntity } from '../psl';

export { PUBLIC_SUFFIXES, entityKeysFor, isEntity };

/** Cap on hostnames generated per entity when a *network* rule has to expand one. */
export const MAX_ENTITY_EXPANSION = ENTITY_EXPANSION_LIMIT;

/**
 * `example.*` → `['example.com', 'example.net', …]`, capped.
 * `base` is the part before `.*` and must already be lower-cased.
 *
 * Only the network compiler needs this; cosmetic/scriptlet DBs keep the entity key.
 */
export function expandEntity(
  base: string,
  suffixes: readonly string[] = PUBLIC_SUFFIXES,
  cap: number = MAX_ENTITY_EXPANSION,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const suffix of suffixes) {
    if (out.length >= cap) break;
    const host = `${base}.${suffix}`;
    if (seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}
