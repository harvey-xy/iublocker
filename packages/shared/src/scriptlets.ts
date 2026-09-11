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
 * One pre-registered MAIN-world bundle: **one per scriptlet name**. docs/SCRIPTLETS.md §3.
 *
 * A group is registered as `js: [...libs, file]`: `libs` holds the single
 * `scriptlet-lib/<name>.js` that defines the function on `self.__iub_lib`, and `file` is a
 * hostname → arguments table for that one scriptlet. The table is walked at runtime
 * against `location.hostname`, so one registration covers every host that calls the
 * scriptlet instead of one registration per distinct call list.
 *
 * `hosts` are the concrete hostnames the registrar turns into match patterns (`*://h/*`
 * plus `*://*.h/*`), minus the ones a parent domain's pattern already covers. The single
 * entry `"*"` means "every URL": the scriptlet has a generic `##+js(...)` call. Scriptlets
 * that match a page only through an entity key (`example.*`) have no literal match pattern
 * and are served by the worker's dynamic path instead.
 */
export interface ScriptletGroup {
  /** Canonical scriptlet name — also the group's identity and file name. */
  name: string;
  /** Content digest of the emitted table; changes whenever the group file changes. */
  hash: string;
  /** `scriptlet-groups/<name>.js` — the hostname → arguments table. */
  file: string;
  /** `scriptlet-lib/<name>.js`, the one file that defines this scriptlet. */
  libs: string[];
  hosts: string[];
  listIds: string[];
  /**
   * Parallel to `hosts`: a bit set per host, bit `i` meaning "`listIds[i]` is why this host
   * is here". The registrar drops a host whose every contributing list is disabled, so
   * turning a list off really does stop its scriptlets. Absent when the build could not
   * encode it (more than 31 lists), which means "register every host".
   */
  hostLists?: number[];
  /** Every distinct call in the group (build-time only; not shipped in the manifest). */
  calls?: ScriptletCall[];
}
