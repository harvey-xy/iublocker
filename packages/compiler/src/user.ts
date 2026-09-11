/**
 * compileUserFilters — the same compiler, run inside the service worker for the user's
 * own filter text. docs/ARCHITECTURE.md §6, docs/FILTER-SYNTAX.md §4 (user tiers) and §6.
 *
 * Strictly isomorphic: no Node built-ins, no dynamic `import()`.
 */
import type { CompiledUserFilters, CosmeticDB, ScriptletDB } from '@iublocker/shared';
import { ID_RANGE, emptyCosmeticDB, emptyScriptletDB } from '@iublocker/shared';
import type {
  CompileCosmeticResult,
  CompileOptions,
  CompileScriptletResult,
  CosmeticNetworkExceptions,
  RawLine,
} from './types';
import { classifyLines } from './parser/classify';
import { compileNetwork } from './network';
import * as cosmeticModule from './cosmetic';
import * as scriptletModule from './scriptlet';

/** The slice of the T2 API this module uses. */
interface CosmeticApi {
  compileCosmetic?: (lines: RawLine[], opts: CompileOptions) => CompileCosmeticResult;
  addCosmeticNetworkExceptions?: (db: CosmeticDB, ex: CosmeticNetworkExceptions) => void;
}

interface ScriptletApi {
  compileScriptlets?: (
    lines: RawLine[],
    opts: CompileOptions & { allowTrustedScriptlets?: boolean },
  ) => CompileScriptletResult;
}

/**
 * T2 (`src/cosmetic`, `src/scriptlet`) is developed in parallel. Resolving its functions
 * through the module namespace keeps this file compiling — and the extension working —
 * whether or not they exist yet.
 */
export function cosmeticApi(): CosmeticApi {
  return cosmeticModule as unknown as CosmeticApi;
}

export function scriptletApi(): ScriptletApi {
  return scriptletModule as unknown as ScriptletApi;
}

export interface UserFilterOptions {
  /** Trusted user filters may use `trusted-*` scriptlets. */
  trusted: boolean;
  allowTrustedScriptlets: boolean;
  /** Override the first dynamic rule id (defaults to the user range start). */
  firstRuleId?: number;
}

export const USER_LIST_ID = 'user';

/**
 * Compile the user's custom filters into dynamic DNR rules plus cosmetic/scriptlet DBs.
 * Rule IDs come from `ID_RANGE.USER`, priorities from the `USER_*` tiers.
 */
export function compileUserFilters(text: string, opts: UserFilterOptions): CompiledUserFilters {
  const classified = classifyLines(text);
  const warnings: string[] = [];

  const network = compileNetwork(classified.network, {
    listId: USER_LIST_ID,
    trusted: opts.trusted,
    priorityScope: 'user',
    firstRuleId: opts.firstRuleId ?? ID_RANGE.USER.start,
    maxRuleId: ID_RANGE.USER.end,
  });
  warnings.push(...network.warnings);
  for (const d of network.dropped) warnings.push(`line ${d.line}: ${d.raw} — ${d.reason}`);

  const compileOptions: CompileOptions = { listId: USER_LIST_ID, trusted: opts.trusted };

  let cosmetic: CosmeticDB = emptyCosmeticDB(USER_LIST_ID);
  const { compileCosmetic, addCosmeticNetworkExceptions } = cosmeticApi();
  if (compileCosmetic !== undefined) {
    const result = compileCosmetic(classified.cosmetic, compileOptions);
    cosmetic = result.db;
    warnings.push(...result.warnings);
    for (const d of result.dropped) warnings.push(`line ${d.line}: ${d.raw} — ${d.reason}`);
  } else if (classified.cosmetic.length > 0) {
    warnings.push('cosmetic filters are not supported by this build');
  }
  if (addCosmeticNetworkExceptions !== undefined) {
    addCosmeticNetworkExceptions(cosmetic, network.cosmeticExceptions);
  }

  let scriptlets: ScriptletDB = emptyScriptletDB(USER_LIST_ID);
  const { compileScriptlets } = scriptletApi();
  if (compileScriptlets !== undefined) {
    const result = compileScriptlets(classified.scriptlet, {
      ...compileOptions,
      allowTrustedScriptlets: opts.allowTrustedScriptlets,
    });
    scriptlets = result.db;
    warnings.push(...result.warnings);
    for (const d of result.dropped) warnings.push(`line ${d.line}: ${d.raw} — ${d.reason}`);
  } else if (classified.scriptlet.length > 0) {
    warnings.push('scriptlet filters are not supported by this build');
  }

  for (const line of classified.html) {
    warnings.push(`line ${line.line}: ${line.raw} — HTML filtering is not supported on MV3`);
  }

  return { dnr: network.rules, cosmetic, scriptlets, warnings };
}
