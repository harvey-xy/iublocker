/**
 * Internal contracts between compiler workstreams (T1 network/CLI, T2 cosmetic/scriptlet).
 * Owned by the architecture; change here first, then in docs/TASKS.md.
 */
import type { CosmeticDB, DNRRule, DroppedFilter, ScriptletDB } from '@iublocker/shared';

export interface RawLine {
  /** 1-based line number in the source list. */
  line: number;
  raw: string;
}

export interface ListMeta {
  title?: string;
  version?: string;
  expires?: string;
  homepage?: string;
  lastModified?: string;
  license?: string;
}

/** Output of the line classifier (T1, parser/classify.ts). */
export interface ClassifiedList {
  meta: ListMeta;
  network: RawLine[];
  cosmetic: RawLine[]; // ##, #@#, #?#, #$#, #@?# …
  scriptlet: RawLine[]; // ##+js(, #@#+js(
  html: RawLine[]; // ##^ (unsupported, reported)
  comments: number;
}

export interface CompileOptions {
  listId: string;
  /** Trusted lists may use trusted-* scriptlets. */
  trusted: boolean;
  /** Environment for !#if directives. */
  env?: 'chromium';
  /** Optional: first rule id for static output (default 1). Dynamic compilation passes the range start. */
  firstRuleId?: number;
  /** Max regex rules to keep (default DNR_LIMITS.MAX_REGEX_RULES_PER_RULESET). */
  maxRegexRules?: number;
}

export interface CosmeticNetworkExceptions {
  elemhide: string[];
  generichide: string[];
  specifichide: string[];
}

/** T1: compileNetwork(lines, opts) */
export interface CompileNetworkResult {
  rules: DNRRule[];
  dropped: DroppedFilter[];
  warnings: string[];
  /** $elemhide/$generichide/$specifichide hostnames, to be merged into the CosmeticDB by the caller. */
  cosmeticExceptions: CosmeticNetworkExceptions;
  counts: { regex: number; redirect: number; modifyHeaders: number; allow: number; block: number };
}

/** T2: compileCosmetic(lines, opts) */
export interface CompileCosmeticResult {
  db: CosmeticDB;
  dropped: DroppedFilter[];
  warnings: string[];
}

/** T2: compileScriptlets(lines, opts) */
export interface CompileScriptletResult {
  db: ScriptletDB;
  dropped: DroppedFilter[];
  warnings: string[];
}
