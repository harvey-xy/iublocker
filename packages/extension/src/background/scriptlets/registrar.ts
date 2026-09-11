/**
 * ScriptletRegistrar — pre-registers the shipped MAIN-world scriptlet bundles.
 * docs/SCRIPTLETS.md §3 path 1, docs/ARCHITECTURE.md D4.
 *
 * The set of groups is fixed at build time (`rulesets/manifest.json.scriptletGroups`) and
 * holds one group per scriptlet **name**, each with the hostnames that call it; at runtime
 * we only decide *which* groups are registered (lists enabled) and on which hosts they must
 * not run (`off`/`basic` sites → `excludeMatches`).
 */
import type { ScriptletGroup } from '@iublocker/shared';
import { log } from '../log';
import { enabledListIds, getManifest } from '../rulesets/manager';
import { hostsBelowOptimal } from '../siteModes';

export const SCRIPT_ID_PREFIX = 'sl-';
const MAX_HOSTS_PER_SCRIPT = 1_000;
const REGISTER_BATCH = 20;

/** `hosts: ['*']` — the group has a generic `##+js(...)` call and runs everywhere. */
const GENERIC_HOST = '*';
const GENERIC_MATCHES = ['http://*/*', 'https://*/*'];

type GroupMeta = Omit<ScriptletGroup, 'calls'>;

function isIpOrSingleLabel(host: string): boolean {
  if (host.startsWith('[') || !host.includes('.')) return true;
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

export function hostPatterns(hosts: readonly string[]): string[] {
  const out: string[] = [];
  for (const host of hosts) {
    if (!host || host.includes('/') || host.includes('*')) continue;
    out.push(`*://${host}/*`);
    // IP literals and single-label hosts have no subdomains; `*://*.127.0.0.1/*` is an
    // invalid match pattern and would make Chrome reject the whole registration.
    if (!isIpOrSingleLabel(host)) out.push(`*://*.${host}/*`);
  }
  return out;
}

function bundlePath(file: string): string {
  const clean = file.replace(/^\/+/, '');
  return clean.startsWith('rulesets/') ? clean : `rulesets/${clean}`;
}

export function groupFilePath(group: GroupMeta): string {
  return bundlePath(group.file && group.file.length > 0 ? group.file : `scriptlet-groups/${group.name}.js`);
}

/**
 * The hosts of a group that at least one *enabled* list asks for.
 *
 * `hostLists[i]` is a bit set over `listIds`: one group serves every list that calls the
 * scriptlet, so without this a host that only a disabled list names would still get the
 * scriptlet registered. A build that could not encode the attribution (more than 31 lists)
 * ships no `hostLists`, and every host is kept.
 */
function enabledHosts(group: GroupMeta, enabled: ReadonlySet<string>): string[] {
  const hosts = (group.hosts ?? []).filter((h) => typeof h === 'string' && h.length > 0);
  const masks = group.hostLists;
  if (!Array.isArray(masks) || masks.length !== hosts.length) return hosts;
  let enabledMask = 0;
  (group.listIds ?? []).forEach((id, index) => {
    if (index < 31 && enabled.has(id)) enabledMask |= 1 << index;
  });
  return hosts.filter((_, index) => ((masks[index] ?? 0) & enabledMask) !== 0);
}

/** Script ids are opaque to Chrome but must stay stable and free of surprises. */
function idPart(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * The `js` array for a group: its `scriptlet-lib/<name>.js` file first (it defines
 * `self.__iub_lib`), then the group's own hostname → arguments table. docs/SCRIPTLETS.md §3.
 *
 * Chrome runs a script's `js` files in order, so the libs are guaranteed to be in place
 * before the group file looks anything up.
 */
export function groupScriptFiles(group: GroupMeta): string[] {
  const libs = Array.isArray(group.libs) ? group.libs : [];
  const out: string[] = [];
  for (const lib of libs) {
    if (typeof lib !== 'string' || lib.length === 0) continue;
    const path = bundlePath(lib);
    if (!out.includes(path)) out.push(path);
  }
  out.push(groupFilePath(group));
  return out;
}

export interface DesiredScript {
  id: string;
  js: string[];
  matches: string[];
  excludeMatches?: string[];
  world: 'MAIN';
  runAt: 'document_start';
  allFrames: true;
  persistAcrossSessions: true;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Pure: the scripts that should be registered for these groups.
 *
 * One entry per (group, chunk of ≤ MAX_HOSTS_PER_SCRIPT hosts); a group whose hosts are
 * just `"*"` registers once against every http(s) URL. Since there is one group per
 * scriptlet *name*, that is a few dozen entries for the shipped lists — small enough that
 * `registerContentScripts` finishes in well under a second.
 */
export function buildDesired(
  groups: readonly GroupMeta[],
  enabled: ReadonlySet<string>,
  excludeHosts: readonly string[],
): DesiredScript[] {
  const excludeMatches = hostPatterns(excludeHosts);
  const out: DesiredScript[] = [];
  for (const group of groups) {
    const name = typeof group?.name === 'string' ? group.name : '';
    if (name === '') continue;
    const listIds = group.listIds ?? [];
    if (listIds.length > 0 && !listIds.some((id) => enabled.has(id))) continue;
    const hosts = enabledHosts(group, enabled);
    if (hosts.length === 0) continue;
    const js = groupScriptFiles(group);
    const parts = hosts.includes(GENERIC_HOST) ? [null] : chunk([...hosts].sort(), MAX_HOSTS_PER_SCRIPT);
    parts.forEach((part, index) => {
      const matches = part === null ? [...GENERIC_MATCHES] : hostPatterns(part);
      if (matches.length === 0) return;
      out.push({
        id: `${SCRIPT_ID_PREFIX}${idPart(name)}-${index}`,
        js,
        matches,
        ...(excludeMatches.length ? { excludeMatches } : {}),
        world: 'MAIN',
        runAt: 'document_start',
        allFrames: true,
        persistAcrossSessions: true,
      });
    });
  }
  return out;
}

function sameScript(a: DesiredScript, b: chrome.scripting.RegisteredContentScript): boolean {
  const eq = (x: readonly string[] | undefined, y: readonly string[] | undefined) =>
    JSON.stringify([...(x ?? [])].sort()) === JSON.stringify([...(y ?? [])].sort());
  return (
    eq(a.js, b.js) &&
    eq(a.matches, b.matches) &&
    eq(a.excludeMatches, b.excludeMatches) &&
    b.world === 'MAIN' &&
    b.runAt === 'document_start' &&
    b.allFrames === true
  );
}

export interface ReconcileResult {
  registered: number;
  updated: number;
  removed: number;
  failed: number;
}

/**
 * Bring `scripting.getRegisteredContentScripts()` in line with the desired set.
 * Called on install, on startup, on list toggles and whenever a site mode changes.
 */
export async function reconcile(): Promise<ReconcileResult> {
  const result: ReconcileResult = { registered: 0, updated: 0, removed: 0, failed: 0 };
  const [manifest, enabled, below] = await Promise.all([
    getManifest(),
    enabledListIds(),
    hostsBelowOptimal(),
  ]);
  const desired = below.defaultBelowOptimal
    ? []
    : buildDesired(manifest.scriptletGroups ?? [], new Set(enabled), below.hosts);

  let existing: chrome.scripting.RegisteredContentScript[] = [];
  try {
    existing = await chrome.scripting.getRegisteredContentScripts();
  } catch (err) {
    log.warn('getRegisteredContentScripts failed', err);
  }
  const ours = existing.filter((script) => script.id.startsWith(SCRIPT_ID_PREFIX));
  const byId = new Map(ours.map((script) => [script.id, script]));
  const desiredIds = new Set(desired.map((script) => script.id));

  const stale = ours.filter((script) => !desiredIds.has(script.id)).map((script) => script.id);
  if (stale.length) {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: stale });
      result.removed = stale.length;
    } catch (err) {
      result.failed++;
      log.warn('unregisterContentScripts failed', err);
    }
  }

  const toRegister = desired.filter((script) => !byId.has(script.id));
  const toUpdate = desired.filter((script) => {
    const current = byId.get(script.id);
    return current !== undefined && !sameScript(script, current);
  });

  for (const batch of chunk(toRegister, REGISTER_BATCH)) {
    try {
      await chrome.scripting.registerContentScripts(batch as chrome.scripting.RegisteredContentScript[]);
      result.registered += batch.length;
    } catch (err) {
      result.failed += batch.length;
      log.warn(`registerContentScripts failed for ${batch.length} script(s)`, err);
    }
  }
  for (const batch of chunk(toUpdate, REGISTER_BATCH)) {
    try {
      await chrome.scripting.updateContentScripts(batch as chrome.scripting.RegisteredContentScript[]);
      result.updated += batch.length;
    } catch (err) {
      result.failed += batch.length;
      log.warn(`updateContentScripts failed for ${batch.length} script(s)`, err);
    }
  }
  log.debug('scriptlet groups reconciled', result);
  return result;
}

/** Remove every group we registered (used when the extension is disabled/reset). */
export async function unregisterAll(): Promise<number> {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts();
    const ids = existing.filter((s) => s.id.startsWith(SCRIPT_ID_PREFIX)).map((s) => s.id);
    if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
    return ids.length;
  } catch (err) {
    log.warn('unregisterAll failed', err);
    return 0;
  }
}
