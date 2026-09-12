/**
 * Worker lifecycle. docs/ARCHITECTURE.md §2 (the worker is killed after ~30 s idle) —
 * `onInstalled`/`onStartup` do the heavy reconciliation, everything else must be able to
 * rebuild its state lazily from storage and the bundle.
 */
import * as cosmeticIndex from './cosmetic/index';
import { errorMessage, log } from './log';
import * as manager from './rulesets/manager';
import { RANGES, clearRange } from './rulesets/dynamic';
import * as registrar from './scriptlets/registrar';
import * as scriptletIndex from './scriptlets/index';
import { getSettings } from './settings';
import * as siteModes from './siteModes';
import * as store from './storage/store';
import { runMigrations } from './storage/migrations';
import * as updater from './updater';

let initialised: Promise<void> | null = null;

/** Cheap, idempotent per-worker-start initialisation. Called by every message. */
export function ensureInitialised(): Promise<void> {
  initialised ??= (async () => {
    await store.ready();
    await getSettings();
  })().catch((err) => {
    initialised = null;
    throw err;
  });
  return initialised;
}

/**
 * A differential update only applies to the ruleset snapshot it was built against; a new
 * extension version ships a new snapshot, so any delta with a different base is dropped.
 */
export async function discardStaleDelta(): Promise<boolean> {
  const [delta, manifest] = await Promise.all([store.get('delta'), manager.getManifest()]);
  if (!delta) return false;
  if (delta.base === manifest.version) return false;
  log.info(`discarding delta ${delta.version} (base ${delta.base} ≠ ${manifest.version})`);
  await clearRange(RANGES.delta);
  await store.set({ delta: null });
  cosmeticIndex.invalidate();
  scriptletIndex.invalidate();
  return true;
}

/**
 * The four reconciliation steps are independent: a failure in one of them (Chrome refusing
 * a ruleset, the static rule budget, a scripting error) must not skip the others. Skipping
 * `syncSessionRules` would leave `off` sites blocked, skipping `registrar.reconcile` would
 * leave every list scriptlet unregistered.
 */
async function reconcileAll(): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    ['applyEnabledRulesets', () => manager.applyEnabledRulesets()],
    ['applyDisabledStaticRules', () => manager.applyDisabledStaticRules()],
    ['syncSessionRules', () => siteModes.syncSessionRules()],
    ['registrar.reconcile', () => registrar.reconcile()],
  ];
  for (const [what, run] of steps) {
    try {
      await run();
    } catch (err) {
      log.error(`${what} failed`, errorMessage(err));
    }
  }
}

export async function onInstalled(details: chrome.runtime.InstalledDetails): Promise<void> {
  try {
    await runMigrations();
    await ensureInitialised();
    // Seeds toggles for lists the user never saw: on a fresh install that is every list
    // (regional ones by UI language), on an update only the newly shipped ones.
    await manager.applyFirstRunDefaults();
    await discardStaleDelta();
    cosmeticIndex.invalidate();
    scriptletIndex.invalidate();
    await reconcileAll();
    await updater.scheduleAlarm();
    log.info(`installed (${details.reason})`);
  } catch (err) {
    log.error('onInstalled failed', errorMessage(err));
  }
}

export async function onStartup(): Promise<void> {
  try {
    await ensureInitialised();
    await reconcileAll();
    await updater.scheduleAlarm();
    log.info('browser startup: session rules and scriptlet groups re-synced');
  } catch (err) {
    log.error('onStartup failed', errorMessage(err));
  }
}

export function __resetForTests(): void {
  initialised = null;
}
