/**
 * ScriptletRegistrar — pre-registers the shipped MAIN-world scriptlet bundles.
 * docs/SCRIPTLETS.md §3 path 1, docs/ARCHITECTURE.md D4.
 *
 * The set of groups is fixed at build time (`rulesets/manifest.json.scriptletGroups`);
 * at runtime we only decide *which* groups are registered (lists enabled) and on which
 * hosts they must not run (`off`/`basic` sites → `excludeMatches`).
 */
import type { ScriptletGroup } from '@iublocker/shared';
import { log } from '../log';
import { enabledListIds, getManifest } from '../rulesets/manager';
import { hostsBelowOptimal } from '../siteModes';

export const SCRIPT_ID_PREFIX = 'sl-';
const MAX_HOSTS_PER_SCRIPT = 1_000;
const REGISTER_BATCH = 20;

type GroupMeta = Omit<ScriptletGroup, 'calls'>;

export function hostPatterns(hosts: readonly string[]): string[] {
  const out: string[] = [];
  for (const host of hosts) {
    if (!host || host.includes('/') || host.includes('*')) continue;
    out.push(`*://${host}/*`, `*://*.${host}/*`);
  }
  return out;
}

export function groupFilePath(group: GroupMeta): string {
  const file = group.file && group.file.length > 0 ? group.file : `scriptlet-groups/${group.hash}.js`;
  const clean = file.replace(/^\/+/, '');
  return clean.startsWith('rulesets/') ? clean : `rulesets/${clean}`;
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

/** Pure: the scripts that should be registered for these groups. */
export function buildDesired(
  groups: readonly GroupMeta[],
  enabled: ReadonlySet<string>,
  excludeHosts: readonly string[],
): DesiredScript[] {
  const excludeMatches = hostPatterns(excludeHosts);
  const out: DesiredScript[] = [];
  for (const group of groups) {
    if (!group?.hash) continue;
    const listIds = group.listIds ?? [];
    if (listIds.length > 0 && !listIds.some((id) => enabled.has(id))) continue;
    const hosts = (group.hosts ?? []).filter((h) => typeof h === 'string' && h.length > 0);
    if (hosts.length === 0) continue;
    const parts = chunk([...hosts].sort(), MAX_HOSTS_PER_SCRIPT);
    parts.forEach((part, index) => {
      out.push({
        id: index === 0 ? `${SCRIPT_ID_PREFIX}${group.hash}` : `${SCRIPT_ID_PREFIX}${group.hash}.${index}`,
        js: [groupFilePath(group)],
        matches: hostPatterns(part),
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
  const [manifest, enabled, below] = await Promise.all([getManifest(), enabledListIds(), hostsBelowOptimal()]);
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
      log.warn(`registerContentScripts failed for ${batch.length} group(s)`, err);
    }
  }
  for (const batch of chunk(toUpdate, REGISTER_BATCH)) {
    try {
      await chrome.scripting.updateContentScripts(batch as chrome.scripting.RegisteredContentScript[]);
      result.updated += batch.length;
    } catch (err) {
      result.failed += batch.length;
      log.warn(`updateContentScripts failed for ${batch.length} group(s)`, err);
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
