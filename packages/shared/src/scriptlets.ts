/** Scriptlet contracts. docs/SCRIPTLETS.md */

export interface ScriptletArgSpec {
  name: string;
  optional?: boolean;
  /** Free-form documentation. */
  doc?: string;
}

export interface ScriptletMeta {
  name: string;
  aliases: string[];
  args: ScriptletArgSpec[];
  /** Only usable from trusted lists / user filters when allowed. */
  trusted: boolean;
  /** Also available as a $redirect resource file (docs/SCRIPTLETS.md §5). */
  redirectResource?: string;
}

/** Shape of packages/scriptlets dist/registry.json */
export interface ScriptletRegistryJSON {
  version: 1;
  scriptlets: ScriptletMeta[];
  /** $redirect name → path under /resources/ */
  redirectResources: Record<string, string>;
}

export interface ScriptletCall {
  name: string;
  args: string[];
}

/**
 * Compiled per-list scriptlet database. docs/SCRIPTLETS.md §2.
 *
 * `byHost` and `exceptions` keys are a concrete hostname, the generic bucket `"*"`, or an
 * **entity key** ending in the literal `.*` (`example.*`). Entity keys are matched at
 * lookup time against the label prefixes above the hostname's public suffix; they are
 * never expanded into concrete hostnames at compile time.
 */
export interface ScriptletDB {
  version: 1;
  listId: string;
  byHost: Record<string, ScriptletCall[]>;
  exceptions: Record<string, string[]>;
}

export function emptyScriptletDB(listId: string): ScriptletDB {
  return { version: 1, listId, byHost: {}, exceptions: {} };
}

/**
 * One pre-registered MAIN-world bundle. docs/SCRIPTLETS.md §3.
 *
 * A group is registered as `js: [...libs, file]`: the libs define the scriptlet functions
 * once each on `self.__iub_lib`, and `file` only carries this group's `run(key, name,
 * args)` calls. Function sources are therefore shared across every group that uses them
 * instead of being duplicated into each bundle.
 *
 * `hosts` are always concrete hostnames (or `"*"`): `registerContentScripts` needs literal
 * match patterns, so scriptlets that only match through an entity key (`example.*`) are
 * served by the worker's dynamic path instead.
 */
export interface ScriptletGroup {
  hash: string;
  /** `scriptlet-groups/<hash>.js` — the call list. */
  file: string;
  /** `scriptlet-lib/<name>.js` files this group needs, in first-use order. */
  libs: string[];
  hosts: string[];
  listIds: string[];
  calls: ScriptletCall[];
}
