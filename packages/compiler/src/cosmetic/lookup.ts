/**
 * Hostname lookup over one or more compiled `CosmeticDB`s.
 *
 * Hot path: runs in the service worker on every `webNavigation.onCommitted`, so it does
 * plain object/Set lookups along the suffix walk and never touches a regex. The only
 * per-DB precomputation (the `$elemhide` family as `Set`s) is memoised in a `WeakMap`.
 */
import type { CosmeticDB, CosmeticLookup, ProceduralFilter } from '@iublocker/shared';
import { hostnameWalk } from '@iublocker/shared';
import { GENERIC_HOST_KEY } from './compile';

interface HideIndex {
  elemhide: Set<string>;
  generichide: Set<string>;
  specifichide: Set<string>;
}

const hideIndexCache = new WeakMap<CosmeticDB, HideIndex>();

function hideIndex(db: CosmeticDB): HideIndex {
  let index = hideIndexCache.get(db);
  if (index === undefined) {
    index = {
      elemhide: new Set(db.exceptions.elemhide),
      generichide: new Set(db.exceptions.generichide),
      specifichide: new Set(db.exceptions.specifichide),
    };
    hideIndexCache.set(db, index);
  }
  return index;
}

/**
 * Union of everything that applies to `hostname` across `dbs`, minus the `#@#` exceptions
 * recorded anywhere along the suffix walk.
 *
 * Filters stored under the `"*"` hostname key (generic `:style()` and generic procedural
 * filters) are always included; callers gate them by site mode.
 */
export function lookupCosmetic(dbs: CosmeticDB[], hostname: string): CosmeticLookup {
  const walk = hostnameWalk(hostname.toLowerCase());

  const excludedSet = new Set<string>();
  let elemhide = false;
  let generichide = false;
  let specifichide = false;

  for (const db of dbs) {
    const index = hideIndex(db);
    for (const host of walk) {
      const list = db.exceptions.selectors[host];
      if (list !== undefined) for (const sel of list) excludedSet.add(sel);
      if (!elemhide && index.elemhide.has(host)) elemhide = true;
      if (!generichide && index.generichide.has(host)) generichide = true;
      if (!specifichide && index.specifichide.has(host)) specifichide = true;
    }
  }

  const selectors: string[] = [];
  const seenSelectors = new Set<string>();
  const styles: [string, string][] = [];
  const seenStyles = new Set<string>();
  const procedural: ProceduralFilter[] = [];
  const seenProcedural = new Set<string>();

  for (const db of dbs) {
    for (const host of walk) {
      const list = db.specific[host];
      if (list === undefined) continue;
      for (const sel of list) {
        if (excludedSet.has(sel) || seenSelectors.has(sel)) continue;
        seenSelectors.add(sel);
        selectors.push(sel);
      }
    }
    for (const host of walk) {
      collectStyles(db, host, excludedSet, seenStyles, styles);
      collectProcedural(db, host, excludedSet, seenProcedural, procedural);
    }
    collectStyles(db, GENERIC_HOST_KEY, excludedSet, seenStyles, styles);
    collectProcedural(db, GENERIC_HOST_KEY, excludedSet, seenProcedural, procedural);
  }

  return {
    selectors,
    styles,
    procedural,
    elemhide,
    generichide,
    specifichide,
    excluded: [...excludedSet],
  };
}

function collectStyles(
  db: CosmeticDB,
  host: string,
  excluded: Set<string>,
  seen: Set<string>,
  out: [string, string][],
): void {
  const list = db.styles[host];
  if (list === undefined) return;
  for (const entry of list) {
    if (excluded.has(entry[0])) continue;
    const id = `${entry[0]} ${entry[1]}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push([entry[0], entry[1]]);
  }
}

function collectProcedural(
  db: CosmeticDB,
  host: string,
  excluded: Set<string>,
  seen: Set<string>,
  out: ProceduralFilter[],
): void {
  const list = db.procedural[host];
  if (list === undefined) return;
  for (const filter of list) {
    if (excluded.has(filter.raw)) continue;
    if (seen.has(filter.raw)) continue;
    seen.add(filter.raw);
    out.push(filter);
  }
}
