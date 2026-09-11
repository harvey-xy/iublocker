/**
 * @iublocker/scriptlets — MAIN-world scriptlet library (workstream T3).
 * The exports below are the frozen public API; T3 replaces the placeholder values.
 */
import type { ScriptletMeta, ScriptletRegistryJSON } from '@iublocker/shared';

export interface ScriptletDefinition extends ScriptletMeta {
  /** Self-contained function (docs/SCRIPTLETS.md §1). Serialised with toString() for bundles. */
  fn: (...args: string[]) => void;
}

/** Canonical name → definition. */
export const registry: Record<string, ScriptletDefinition> = {};

/** Resolve by canonical name or alias. */
export function resolveScriptlet(nameOrAlias: string): ScriptletDefinition | undefined {
  const n = nameOrAlias.endsWith('.js') ? nameOrAlias.slice(0, -3) : nameOrAlias;
  if (registry[n]) return registry[n];
  for (const def of Object.values(registry)) if (def.aliases.includes(n)) return def;
  return undefined;
}

/** $redirect resource name (and aliases) → path under /resources/ (e.g. "noop.js" → "resources/noop.js"). */
export const redirectResources: Record<string, string> = {};

export function registryJSON(): ScriptletRegistryJSON {
  return {
    version: 1,
    scriptlets: Object.values(registry).map(({ fn: _fn, ...meta }) => meta),
    redirectResources,
  };
}
