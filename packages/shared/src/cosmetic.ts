/** Compiled cosmetic database. docs/COSMETIC-FILTERING.md §2 */

export type ProceduralTask =
  | ['has-text', string]
  | ['matches-css', string]
  | ['matches-css-before', string]
  | ['matches-css-after', string]
  | ['matches-attr', string]
  | ['matches-path', string]
  | ['matches-media', string]
  | ['min-text-length', number]
  | ['upward', number | string]
  | ['xpath', string]
  | ['watch-attr', string]
  | ['others']
  | ['remove']
  | ['style', string]
  | ['has', ProceduralFilter]
  | ['not', ProceduralFilter]
  /** A plain CSS selector step applied with querySelectorAll on the current set (or document at the start). */
  | ['css', string];

export interface ProceduralFilter {
  raw: string;
  tasks: ProceduralTask[];
}

export interface CosmeticGeneric {
  byId: Record<string, string[]>;
  byClass: Record<string, string[]>;
  complex: string[];
}

export interface CosmeticExceptions {
  /** Key (hostname, `"*"` or entity key) → selectors cancelled there. */
  selectors: Record<string, string[]>;
  elemhide: string[];
  generichide: string[];
  specifichide: string[];
}

/**
 * Compiled per-list cosmetic database. docs/COSMETIC-FILTERING.md §2.
 *
 * Every key in `specific`, `styles`, `procedural` and `exceptions.selectors` is one of:
 * an exact hostname, the generic bucket `"*"`, or an **entity key** ending in the literal
 * `.*` (`example.*`). Entity keys are matched at lookup time against the label prefixes
 * above the hostname's public suffix — they are never expanded into concrete hostnames at
 * compile time.
 */
export interface CosmeticDB {
  version: 1;
  listId: string;
  generic: CosmeticGeneric;
  specific: Record<string, string[]>;
  styles: Record<string, [selector: string, style: string][]>;
  procedural: Record<string, ProceduralFilter[]>;
  exceptions: CosmeticExceptions;
}

export function emptyCosmeticDB(listId: string): CosmeticDB {
  return {
    version: 1,
    listId,
    generic: { byId: {}, byClass: {}, complex: [] },
    specific: {},
    styles: {},
    procedural: {},
    exceptions: { selectors: {}, elemhide: [], generichide: [], specifichide: [] },
  };
}

/** Result of looking up a hostname in one or more DBs. */
export interface CosmeticLookup {
  /** Plain selectors to hide (specific), already minus exceptions. */
  selectors: string[];
  styles: [selector: string, style: string][];
  procedural: ProceduralFilter[];
  elemhide: boolean;
  generichide: boolean;
  specifichide: boolean;
  /** Selectors excluded by #@# for this hostname (applied to generic too). */
  excluded: string[];
}
