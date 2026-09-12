/** Settings read/write with validation. docs/STORAGE.md */
import { DEFAULT_SETTINGS, SITE_MODES, type Settings, type SiteMode } from '@iublocker/shared';
import { setDebug } from './log';
import * as store from './storage/store';

const MIN_UPDATE_INTERVAL_HOURS = 1;
const MAX_UPDATE_INTERVAL_HOURS = 24 * 7;

export async function getSettings(): Promise<Settings> {
  const settings = await store.get('settings');
  setDebug(settings.advanced.logMatchedRules);
  return settings;
}

export async function getDefaultMode(): Promise<SiteMode> {
  return (await getSettings()).defaultMode;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function sanitiseUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return fallback;
    return value.replace(/\/+$/, '');
  } catch {
    return fallback;
  }
}

/** Validate + clamp a patch against the current settings. Unknown keys are dropped. */
export function sanitiseSettings(current: Settings, patch: Partial<Settings>): Settings {
  const next: Settings = { ...current, advanced: { ...current.advanced } };
  if (patch.defaultMode !== undefined && SITE_MODES.includes(patch.defaultMode))
    next.defaultMode = patch.defaultMode;
  if (patch.showBadgeCount !== undefined) next.showBadgeCount = Boolean(patch.showBadgeCount);
  if (patch.autoUpdate !== undefined) next.autoUpdate = Boolean(patch.autoUpdate);
  if (patch.updateIntervalHours !== undefined) {
    next.updateIntervalHours = clampNumber(
      patch.updateIntervalHours,
      current.updateIntervalHours,
      MIN_UPDATE_INTERVAL_HOURS,
      MAX_UPDATE_INTERVAL_HOURS,
    );
  }
  if (patch.updateChannel === 'stable' || patch.updateChannel === 'nightly')
    next.updateChannel = patch.updateChannel;
  if (patch.collapseBlockedElements !== undefined)
    next.collapseBlockedElements = Boolean(patch.collapseBlockedElements);
  if (patch.cloudDeltaBaseUrl !== undefined) {
    next.cloudDeltaBaseUrl = sanitiseUrl(patch.cloudDeltaBaseUrl, DEFAULT_SETTINGS.cloudDeltaBaseUrl);
  }
  if (patch.theme === 'auto' || patch.theme === 'light' || patch.theme === 'dark') next.theme = patch.theme;
  if (patch.advanced) {
    if (patch.advanced.logMatchedRules !== undefined)
      next.advanced.logMatchedRules = Boolean(patch.advanced.logMatchedRules);
    if (patch.advanced.allowTrustedUserScriptlets !== undefined) {
      next.advanced.allowTrustedUserScriptlets = Boolean(patch.advanced.allowTrustedUserScriptlets);
    }
  }
  return next;
}

export interface SettingsChange {
  settings: Settings;
  previous: Settings;
  /** Keys whose value actually changed. */
  changed: (keyof Settings)[];
}

export async function setSettings(patch: Partial<Settings>): Promise<SettingsChange> {
  let previous = await store.get('settings');
  let changed: (keyof Settings)[] = [];
  // Serialised read-modify-write: the popup and the dashboard both write `settings`, and a
  // plain get/set pair drops one of two overlapping saves.
  const settings = await store.update('settings', (current) => {
    previous = current;
    const next = sanitiseSettings(current, patch);
    changed = (Object.keys(next) as (keyof Settings)[]).filter(
      (key) => JSON.stringify(next[key]) !== JSON.stringify(current[key]),
    );
    return changed.length ? next : current;
  });
  setDebug(settings.advanced.logMatchedRules);
  return { settings, previous, changed };
}
