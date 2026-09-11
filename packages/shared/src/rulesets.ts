import type { DNRRule } from './dnr';
import type { CosmeticDB } from './cosmetic';
import type { ScriptletCall, ScriptletDB, ScriptletGroup } from './scriptlets';

export type ListGroup = 'ads' | 'privacy' | 'malware' | 'annoyances' | 'regional' | 'custom' | 'test';

export interface RulesetListEntry {
  id: string;
  title: string;
  group: ListGroup;
  lang?: string[];
  defaultEnabled: boolean;
  trusted: boolean;
  homepage?: string;
  license?: string;
  sources: { url: string; sha256: string; fetchedAt: string }[];
  counts: {
    dnr: number;
    regex: number;
    cosmeticGeneric: number;
    cosmeticSpecific: number;
    procedural: number;
    scriptlets: number;
    dropped: number;
  };
  files: { dnr: string; cosmetic: string; scriptlets: string };
}

/** rulesets/manifest.json. docs/RULESETS.md §2 */
export interface RulesetManifest {
  version: string;
  builtAt: string;
  lists: RulesetListEntry[];
  budget: { staticRulesTotal: number; staticRulesDefaultEnabled: number; regexTotal: number };
  scriptletGroups: Omit<ScriptletGroup, 'calls'>[];
  /**
   * Hostnames whose scriptlet group was demoted by the per-list group cap, plus nothing
   * else. The worker injects their calls with `executeScript` at `onCommitted` instead of
   * relying on a pre-registered bundle. docs/SCRIPTLETS.md §3.
   */
  scriptletDynamicHosts?: string[];
}

export interface DroppedFilter {
  listId: string;
  line: number;
  raw: string;
  reason: string;
}

export interface RulesetReport {
  version: string;
  lists: Record<string, RulesetListEntry['counts'] & { dropped: number; warnings: string[] }>;
  dropped: DroppedFilter[];
}

/** Output of compiling user filters in the browser. */
export interface CompiledUserFilters {
  dnr: DNRRule[];
  cosmetic: CosmeticDB;
  scriptlets: ScriptletDB;
  warnings: string[];
}

/** Differential update payload. docs/RULESETS.md §6 */
export interface DeltaFile {
  base: string;
  version: string;
  builtAt: string;
  dnr: {
    add: DNRRule[];
    disable: Record<string, number[]>;
  };
  cosmetic: {
    add: CosmeticDB;
    /** hostname → selectors to remove from specific sets */
    removeSpecific: Record<string, string[]>;
  };
  scriptlets: {
    add: ScriptletDB;
    remove: Record<string, ScriptletCall[]>;
  };
}
