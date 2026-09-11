/**
 * @iublocker/compiler — isomorphic filter-list compiler.
 * Public API (implemented by workstreams T1/T2, see docs/TASKS.md):
 *
 *   parseList(text, opts): ParsedList
 *   compileNetwork(filters, opts): { rules: DNRRule[]; dropped: DroppedFilter[] }
 *   compileCosmetic(filters, opts): CosmeticDB
 *   compileScriptlets(filters, opts): ScriptletDB
 *   compileUserFilters(text, opts): CompiledUserFilters
 *   lookupCosmetic(dbs, hostname): CosmeticLookup
 *   mergeCosmeticDB(a, b): CosmeticDB
 */
export {};
