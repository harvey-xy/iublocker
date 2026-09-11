/**
 * Per-site modes. docs/ARCHITECTURE.md §5.
 *
 * Resolution: exact hostname → parent domains → `settings.defaultMode`.
 * `off` additionally installs a session `allowAllRequests` rule (ID_RANGE.SITE /
 * PRIORITY.SITE_OFF) so DNR stops blocking for that site in the network process.
 */
import {
  DNR_LIMITS,
  ID_RANGE,
  PRIORITY,
  SITE_MODE_LEVEL,
  hostnameWalk,
  isValidHostname,
  modeAtLeast,
  type DNRRule,
  type SiteMode,
} from '@iublocker/shared';
import { log } from './log';
import { getSettings } from './settings';
import * as store from './storage/store';

/** Max domains per session rule; keeps single rules cheap to evaluate. */
const DOMAINS_PER_RULE = 5_000;
const MAX_SITE_RULES = Math.min(
  ID_RANGE.SITE.end - ID_RANGE.SITE.start + 1,
  DNR_LIMITS.MAX_SESSION_RULES,
);

export function normaliseHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

export async function getSiteModes(): Promise<Record<string, SiteMode>> {
  return store.get('siteModes');
}

/** Explicit override for exactly this hostname (no walk). */
export async function getExplicitMode(hostname: string): Promise<SiteMode | null> {
  const modes = await getSiteModes();
  return modes[normaliseHostname(hostname)] ?? null;
}

export function resolveModeFrom(
  hostname: string,
  modes: Record<string, SiteMode>,
  defaultMode: SiteMode,
): SiteMode {
  const host = normaliseHostname(hostname);
  if (!host) return defaultMode;
  for (const candidate of hostnameWalk(host)) {
    const mode = modes[candidate];
    if (mode) return mode;
  }
  return defaultMode;
}

export async function resolveMode(hostname: string): Promise<SiteMode> {
  const [modes, settings] = await Promise.all([getSiteModes(), getSettings()]);
  return resolveModeFrom(hostname, modes, settings.defaultMode);
}

export async function setMode(hostname: string, mode: SiteMode | null): Promise<SiteMode> {
  const host = normaliseHostname(hostname);
  if (!host || !isValidHostname(host)) throw new Error(`invalid hostname: ${hostname}`);
  const modes = { ...(await getSiteModes()) };
  if (mode === null) delete modes[host];
  else modes[host] = mode;
  await store.set({ siteModes: modes });
  await syncSessionRules();
  const settings = await getSettings();
  return resolveModeFrom(host, modes, settings.defaultMode);
}

/** Hostnames whose effective mode is below `optimal` (no cosmetics / no scriptlets). */
export async function hostsBelowOptimal(): Promise<{ hosts: string[]; defaultBelowOptimal: boolean }> {
  const [modes, settings] = await Promise.all([getSiteModes(), getSettings()]);
  const hosts = Object.entries(modes)
    .filter(([, mode]) => !modeAtLeast(mode, 'optimal'))
    .map(([host]) => host)
    .sort();
  return { hosts, defaultBelowOptimal: !modeAtLeast(settings.defaultMode, 'optimal') };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The session rules that represent the current `off` sites. Pure; exported for tests. */
export function buildSiteRules(modes: Record<string, SiteMode>, defaultMode: SiteMode): DNRRule[] {
  const off: string[] = [];
  const notOff: string[] = [];
  for (const [host, mode] of Object.entries(modes)) {
    (mode === 'off' ? off : notOff).push(host);
  }
  off.sort();
  notOff.sort();

  const rules: DNRRule[] = [];
  let id = ID_RANGE.SITE.start;

  if (defaultMode === 'off') {
    // Everything is off except hostnames explicitly set to another mode.
    rules.push({
      id,
      priority: PRIORITY.SITE_OFF,
      action: { type: 'allowAllRequests' },
      condition: {
        urlFilter: '*',
        resourceTypes: ['main_frame', 'sub_frame'],
        ...(notOff.length ? { excludedRequestDomains: notOff.slice(0, DOMAINS_PER_RULE) } : {}),
      },
    });
    return rules;
  }

  for (const domains of chunk(off, DOMAINS_PER_RULE)) {
    if (rules.length >= MAX_SITE_RULES) break;
    // A sub-hostname may re-enable blocking below an `off` parent.
    const excluded = notOff.filter((h) => domains.some((d) => h !== d && h.endsWith(`.${d}`)));
    rules.push({
      id: id++,
      priority: PRIORITY.SITE_OFF,
      action: { type: 'allowAllRequests' },
      condition: {
        requestDomains: domains,
        resourceTypes: ['main_frame', 'sub_frame'],
        ...(excluded.length ? { excludedRequestDomains: excluded } : {}),
      },
    });
  }
  return rules;
}

/**
 * Rewrite the ID_RANGE.SITE session rules so they match storage. Called on startup, on
 * mode changes and whenever `settings.defaultMode` changes.
 */
export async function syncSessionRules(): Promise<DNRRule[]> {
  const [modes, settings] = await Promise.all([getSiteModes(), getSettings()]);
  const desired = buildSiteRules(modes, settings.defaultMode);
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const removeRuleIds = existing
    .map((rule) => rule.id)
    .filter((ruleId) => ruleId >= ID_RANGE.SITE.start && ruleId <= ID_RANGE.SITE.end);

  if (removeRuleIds.length === 0 && desired.length === 0) return desired;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds,
      addRules: desired as unknown as chrome.declarativeNetRequest.Rule[],
    });
  } catch (err) {
    log.error('failed to sync site-mode session rules', err);
    throw err;
  }
  log.debug(`site session rules: ${desired.length} rule(s)`);
  return desired;
}

export function modeLevel(mode: SiteMode): number {
  return SITE_MODE_LEVEL[mode];
}
