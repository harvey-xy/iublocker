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

export interface ScriptletDB {
  version: 1;
  listId: string;
  byHost: Record<string, ScriptletCall[]>;
  exceptions: Record<string, string[]>;
}

export function emptyScriptletDB(listId: string): ScriptletDB {
  return { version: 1, listId, byHost: {}, exceptions: {} };
}

/** One pre-registered MAIN-world bundle. docs/SCRIPTLETS.md §3 */
export interface ScriptletGroup {
  hash: string;
  file: string;
  hosts: string[];
  listIds: string[];
  calls: ScriptletCall[];
}
