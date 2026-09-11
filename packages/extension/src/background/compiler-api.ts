/**
 * Typed view of the parts of `@iublocker/compiler` the service worker uses.
 *
 * The compiler package is written concurrently (workstreams T1/T2); until those exports
 * land, a direct named import would break `tsc`. We therefore import the namespace and
 * project it onto the frozen signatures documented in `packages/compiler/src/index.ts`.
 * When T1/T2 have landed this file can be reduced to plain re-exports without touching
 * any caller.
 */
import * as compiler from '@iublocker/compiler';
import type {
  CompiledUserFilters,
  CosmeticDB,
  CosmeticLookup,
  ScriptletCall,
  ScriptletDB,
} from '@iublocker/shared';
import { emptyCosmeticDB } from '@iublocker/shared';

export interface CompilerApi {
  compileUserFilters(text: string, opts: { trusted: boolean; allowTrustedScriptlets: boolean }): CompiledUserFilters;
  mergeCosmeticDB(target: CosmeticDB, source: CosmeticDB): CosmeticDB;
  lookupCosmetic(dbs: CosmeticDB[], hostname: string): CosmeticLookup;
  mergeScriptletDB(target: ScriptletDB, source: ScriptletDB): ScriptletDB;
  lookupScriptlets(dbs: ScriptletDB[], hostname: string): ScriptletCall[];
}

const api = compiler as unknown as Partial<CompilerApi>;

function missing(name: keyof CompilerApi): never {
  throw new Error(`@iublocker/compiler.${name}() is not available in this build`);
}

export function compileUserFilters(
  text: string,
  opts: { trusted: boolean; allowTrustedScriptlets: boolean },
): CompiledUserFilters {
  if (!api.compileUserFilters) missing('compileUserFilters');
  return api.compileUserFilters(text, opts);
}

export function mergeCosmeticDB(target: CosmeticDB, source: CosmeticDB): CosmeticDB {
  if (!api.mergeCosmeticDB) missing('mergeCosmeticDB');
  return api.mergeCosmeticDB(target, source);
}

export function lookupCosmetic(dbs: CosmeticDB[], hostname: string): CosmeticLookup {
  if (!api.lookupCosmetic) {
    return { selectors: [], styles: [], procedural: [], elemhide: false, generichide: false, specifichide: false, excluded: [] };
  }
  return api.lookupCosmetic(dbs, hostname);
}

export function mergeScriptletDB(target: ScriptletDB, source: ScriptletDB): ScriptletDB {
  if (!api.mergeScriptletDB) missing('mergeScriptletDB');
  return api.mergeScriptletDB(target, source);
}

export function lookupScriptlets(dbs: ScriptletDB[], hostname: string): ScriptletCall[] {
  if (!api.lookupScriptlets) return [];
  return api.lookupScriptlets(dbs, hostname);
}

/** True when the compiler build in use can compile user filters. */
export function canCompile(): boolean {
  return typeof api.compileUserFilters === 'function';
}

export { emptyCosmeticDB };
