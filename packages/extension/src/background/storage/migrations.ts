/**
 * Storage migrations. docs/STORAGE.md — every key is versioned through a single
 * `schemaVersion`. A migration upgrades the raw `storage.local` bag from version N to
 * N + 1 and must be idempotent and tolerant of missing keys.
 */
import { SCHEMA_VERSION } from '@iublocker/shared';
import { log } from '../log';
import { defaults, raw } from './store';

export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSION;

type Migration = (data: Record<string, unknown>) => void;

/** Keyed by the version being migrated *from*. */
const MIGRATIONS: Record<number, Migration> = {
  // 0 → 1: fresh install or pre-schemaVersion data; seed missing keys with defaults.
  0: (data) => {
    const base = defaults() as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(base)) {
      if (!(key in data)) data[key] = value;
    }
  },
};

export interface MigrationResult {
  from: number;
  to: number;
  applied: number[];
}

export async function runMigrations(): Promise<MigrationResult> {
  const data = await raw.getAll();
  const stored = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;
  const applied: number[] = [];
  if (stored > CURRENT_SCHEMA_VERSION) {
    log.warn(
      `storage schemaVersion ${stored} is newer than ${CURRENT_SCHEMA_VERSION}; leaving data untouched`,
    );
    return { from: stored, to: stored, applied };
  }
  for (let v = stored; v < CURRENT_SCHEMA_VERSION; v++) {
    const migration = MIGRATIONS[v];
    if (migration) {
      try {
        migration(data);
        applied.push(v);
      } catch (err) {
        log.error(`migration ${v} → ${v + 1} failed`, err);
        throw err;
      }
    }
  }
  data.schemaVersion = CURRENT_SCHEMA_VERSION;
  await raw.set(data);
  raw.invalidate();
  if (applied.length) log.info('storage migrated', stored, '→', CURRENT_SCHEMA_VERSION);
  return { from: stored, to: CURRENT_SCHEMA_VERSION, applied };
}
