/**
 * @iublocker/compiler — isomorphic filter-list compiler (no Node built-ins outside ./cli).
 *
 * T1 (parser/, network/, dnr/, cli/):
 *   classifyLines(text: string, opts?: { env?: 'chromium' }): ClassifiedList
 *   compileNetwork(lines: RawLine[], opts: CompileOptions): CompileNetworkResult
 *   compileUserFilters(text: string, opts: { trusted: boolean; allowTrustedScriptlets: boolean }): CompiledUserFilters
 *
 * T2 (cosmetic/, scriptlet/):
 *   compileCosmetic(lines: RawLine[], opts: CompileOptions): CompileCosmeticResult
 *   addCosmeticNetworkExceptions(db: CosmeticDB, ex: CosmeticNetworkExceptions): void
 *   mergeCosmeticDB(target: CosmeticDB, source: CosmeticDB): CosmeticDB
 *   lookupCosmetic(dbs: CosmeticDB[], hostname: string): CosmeticLookup
 *   compileScriptlets(lines: RawLine[], opts: CompileOptions): CompileScriptletResult
 *   mergeScriptletDB(target: ScriptletDB, source: ScriptletDB): ScriptletDB
 *   lookupScriptlets(dbs: ScriptletDB[], hostname: string): ScriptletCall[]
 *   computeScriptletGroups(dbs: { listId: string; db: ScriptletDB }[]): ScriptletGroup[]
 *   emitScriptletGroupBundle(group: ScriptletGroup): string   // JS source for registerContentScripts
 */
export * from './types';
export * from './parser';
export * from './network';
export * from './cosmetic';
export * from './scriptlet';
export * from './user';
