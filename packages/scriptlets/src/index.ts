/**
 * @iublocker/scriptlets — MAIN-world scriptlet library (workstream T3).
 * Public API:
 *   export const registry: Record<string, ScriptletDefinition>   // by canonical name
 *   export function resolveScriptlet(nameOrAlias): ScriptletDefinition | undefined
 *   export const redirectResources: Record<string, string>       // $redirect name → /resources/<file>
 *   export function registryJSON(): ScriptletRegistryJSON
 * A ScriptletDefinition = ScriptletMeta & { fn: (...args: string[]) => void }
 * `fn` must be self-contained (docs/SCRIPTLETS.md §1).
 */
export {};
