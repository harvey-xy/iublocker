/**
 * fetch-lists — download every filter list in tools/filterlists.json into the local
 * cache used by the compiler (`pnpm rulesets:build`).
 *
 * docs/BUILD-AND-RELEASE.md, docs/RULESETS.md §1.
 *
 *   pnpm rulesets:fetch [--only a,b] [--cache .cache/lists] [--lists tools/filterlists.json]
 *                       [--force] [--allow-missing] [--snapshot e2e/fixtures/lists]
 *
 * Output per list id:
 *   <cache>/<id>.txt        all sources concatenated, `!#include` expanded
 *   <cache>/<id>.meta.json  { id, sources: [{ url, sha256, fetchedAt, bytes }], mirror, fetchedAt }
 *
 * When a list's primary `urls` cannot be fetched, each set in its optional `mirrors` is
 * tried in order; `meta.mirror` records the index of the set that worked (null = primary).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boolFlag, listFlag, parseArgs, stringFlag } from './lib/args';
import type { FilterListSource, FilterListsConfig } from '../packages/shared/src/filterlists';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Path for logs: relative to the repo when inside it, absolute otherwise. */
function display(target: string): string {
  const rel = path.relative(REPO_ROOT, target);
  return rel.startsWith('..') ? target : rel;
}

const CONCURRENCY = 4;
const TIMEOUT_MS = 60_000;
const RETRIES = 3;
const MAX_INCLUDE_DEPTH = 3;
const FRESH_MS = 6 * 60 * 60 * 1000;
const SEPARATOR = (url: string) => `! >>> source: ${url}`;

export interface SourceMeta {
  url: string;
  sha256: string;
  fetchedAt: string;
  bytes: number;
}

export interface ListMeta {
  id: string;
  sources: SourceMeta[];
  /** Index into the list's `mirrors`, or null when the primary `urls` were used. */
  mirror: number | null;
  fetchedAt: string;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const USAGE = `Usage: tsx tools/fetch-lists.ts [options]

  --lists <file>      filter list config (default tools/filterlists.json)
  --cache <dir>       output directory (default .cache/lists)
  --only a,b          only fetch these list ids
  --force             ignore the ${FRESH_MS / 3_600_000}h freshness cache
  --allow-missing     exit 0 even when some lists could not be fetched
  --snapshot <dir>    copy the checked-in snapshot from <dir> instead of downloading
  --help
`;

/* ------------------------------------------------------------------ fetching */

class FetchError extends Error {}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** GET a URL as text, with a timeout and exponential backoff. */
export async function fetchText(url: string, retries = RETRIES, timeoutMs = TIMEOUT_MS): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await delay(Math.min(500 * 2 ** (attempt - 1), 8_000));
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'iublocker-fetch-lists/1 (+https://github.com/harvey-xy/iublocker)' },
      });
      if (!res.ok) throw new FetchError(`HTTP ${res.status} ${res.statusText}`);
      const text = await res.text();
      if (text.trim().length === 0) throw new FetchError('empty response body');
      return text;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`  ! attempt ${attempt + 1}/${retries + 1} failed for ${url}: ${message}`);
    }
  }
  throw new Error(
    `could not fetch ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/* ----------------------------------------------------------------- includes */

const INCLUDE_RE = /^!#include\s+(\S+)\s*$/;

interface ExpandResult {
  text: string;
  sources: SourceMeta[];
}

/**
 * Expand `!#include <relative>` directives (uBO/AdGuard syntax). Paths resolve against
 * the URL of the including source. Recursion is capped at MAX_INCLUDE_DEPTH and cycles
 * are replaced by a comment so a broken list never hangs the build.
 */
export async function expandIncludes(
  text: string,
  baseUrl: string,
  fetcher: (url: string) => Promise<string>,
  depth = 0,
  seen: ReadonlySet<string> = new Set(),
): Promise<ExpandResult> {
  if (!text.includes('!#include')) return { text, sources: [] };

  const out: string[] = [];
  const sources: SourceMeta[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = INCLUDE_RE.exec(line);
    if (!m || m[1] === undefined) {
      out.push(line);
      continue;
    }
    let target: string;
    try {
      target = new URL(m[1], baseUrl).href;
    } catch {
      out.push(`! [iublocker] unresolvable include: ${line}`);
      continue;
    }
    if (depth >= MAX_INCLUDE_DEPTH) {
      out.push(`! [iublocker] include depth limit reached, skipped: ${target}`);
      continue;
    }
    if (seen.has(target)) {
      out.push(`! [iublocker] include cycle, skipped: ${target}`);
      continue;
    }
    let body: string;
    try {
      body = await fetcher(target);
    } catch (err) {
      out.push(
        `! [iublocker] include failed (${err instanceof Error ? err.message : String(err)}): ${target}`,
      );
      continue;
    }
    sources.push({
      url: target,
      sha256: sha256(body),
      fetchedAt: new Date().toISOString(),
      bytes: Buffer.byteLength(body),
    });
    const nested = await expandIncludes(body, target, fetcher, depth + 1, new Set([...seen, target]));
    sources.push(...nested.sources);
    out.push(SEPARATOR(target), nested.text);
  }
  return { text: out.join('\n'), sources };
}

/* -------------------------------------------------------------- one list job */

export type Fetcher = (url: string) => Promise<string>;

/** Fetch one complete set of URLs (primary or mirror). Rejects unless every URL succeeds. */
async function fetchUrlSet(
  urls: readonly string[],
  fetcher: Fetcher,
): Promise<{ text: string; sources: SourceMeta[] }> {
  if (urls.length === 0) throw new Error('no URLs in source set');
  const chunks: string[] = [];
  const sources: SourceMeta[] = [];
  for (const url of urls) {
    const body = await fetcher(url);
    sources.push({
      url,
      sha256: sha256(body),
      fetchedAt: new Date().toISOString(),
      bytes: Buffer.byteLength(body),
    });
    const expanded = await expandIncludes(body, url, fetcher, 0, new Set([url]));
    sources.push(...expanded.sources);
    chunks.push(SEPARATOR(url), expanded.text);
  }
  return { text: `${chunks.join('\n')}\n`, sources };
}

/** Label for a source set in logs and error messages. */
function setLabel(mirror: number | null): string {
  return mirror === null ? 'primary' : `mirror ${mirror}`;
}

/**
 * Fetch a list from its primary `urls`, falling back to each set in `mirrors` in order.
 * A mirror set is only used when every URL in it is fetched successfully; the index of
 * the set that worked is recorded in `meta.mirror` (null for the primary).
 */
export async function fetchList(
  list: FilterListSource,
  fetcher: Fetcher = (url) => fetchText(url),
): Promise<{ text: string; meta: ListMeta }> {
  const attempts: { mirror: number | null; urls: readonly string[] }[] = [
    { mirror: null, urls: list.urls },
    ...(list.mirrors ?? []).map((urls, index) => ({ mirror: index, urls })),
  ];

  const errors: string[] = [];
  for (const [index, attempt] of attempts.entries()) {
    try {
      const { text, sources } = await fetchUrlSet(attempt.urls, fetcher);
      if (attempt.mirror !== null) {
        console.warn(`  ~ ${list.id}: served by ${setLabel(attempt.mirror)}`);
      }
      return {
        text,
        meta: {
          id: list.id,
          sources,
          mirror: attempt.mirror,
          fetchedAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${setLabel(attempt.mirror)}: ${message}`);
      const next = attempts[index + 1];
      if (next !== undefined) {
        console.warn(
          `  ~ ${list.id}: ${setLabel(attempt.mirror)} failed (${message}), trying ${setLabel(next.mirror)}`,
        );
      }
    }
  }
  throw new Error(errors.join('; '));
}

async function readMeta(cacheDir: string, id: string): Promise<ListMeta | null> {
  try {
    return JSON.parse(await readFile(path.join(cacheDir, `${id}.meta.json`), 'utf8')) as ListMeta;
  } catch {
    return null;
  }
}

async function isFresh(cacheDir: string, id: string): Promise<boolean> {
  const meta = await readMeta(cacheDir, id);
  if (!meta?.fetchedAt) return false;
  const age = Date.now() - Date.parse(meta.fetchedAt);
  if (!Number.isFinite(age) || age < 0 || age > FRESH_MS) return false;
  try {
    await readFile(path.join(cacheDir, `${id}.txt`), 'utf8');
    return true;
  } catch {
    return false;
  }
}

async function writeList(cacheDir: string, id: string, text: string, meta: ListMeta): Promise<void> {
  await writeFile(path.join(cacheDir, `${id}.txt`), text, 'utf8');
  await writeFile(path.join(cacheDir, `${id}.meta.json`), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

/** Copy `<snapshotDir>/<id>.txt` (+ meta, synthesised when absent) into the cache. */
async function copySnapshot(snapshotDir: string, cacheDir: string, list: FilterListSource): Promise<boolean> {
  let text: string;
  try {
    text = await readFile(path.join(snapshotDir, `${list.id}.txt`), 'utf8');
  } catch {
    return false;
  }
  const existing = await readMeta(snapshotDir, list.id);
  const meta: ListMeta = existing
    ? { ...existing, mirror: existing.mirror ?? null }
    : {
        id: list.id,
        sources: [
          {
            url: `snapshot:${list.id}.txt`,
            sha256: sha256(text),
            fetchedAt: '1970-01-01T00:00:00.000Z',
            bytes: Buffer.byteLength(text),
          },
        ],
        mirror: null,
        fetchedAt: '1970-01-01T00:00:00.000Z',
      };
  await writeList(cacheDir, list.id, text, meta);
  return true;
}

/* --------------------------------------------------------------------- main */

async function pool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      const item = items[index];
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv, { boolean: ['force', 'allow-missing', 'help'] });
  if (boolFlag(args, 'help')) {
    console.log(USAGE);
    return 0;
  }

  const listsFile = path.resolve(REPO_ROOT, stringFlag(args, 'lists') ?? 'tools/filterlists.json');
  const cacheDir = path.resolve(REPO_ROOT, stringFlag(args, 'cache') ?? '.cache/lists');
  const snapshotDir = stringFlag(args, 'snapshot')
    ? path.resolve(REPO_ROOT, stringFlag(args, 'snapshot') as string)
    : null;
  const only = listFlag(args, 'only');
  const force = boolFlag(args, 'force');
  const allowMissing = boolFlag(args, 'allow-missing');

  let config: FilterListsConfig;
  try {
    config = JSON.parse(await readFile(listsFile, 'utf8')) as FilterListsConfig;
  } catch (err) {
    console.error(
      `fetch-lists: cannot read ${display(listsFile)}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
  if (!Array.isArray(config.lists) || config.lists.length === 0) {
    console.error(`fetch-lists: no lists in ${listsFile}`);
    return 1;
  }
  if (only) {
    const known = new Set(config.lists.map((l) => l.id));
    const unknown = only.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      console.error(`fetch-lists: unknown list id(s) in --only: ${unknown.join(', ')}`);
      return 1;
    }
  }
  const lists = config.lists.filter((l) => !only || only.includes(l.id));

  await mkdir(cacheDir, { recursive: true });
  console.info(
    `fetch-lists: ${lists.length} list(s) → ${display(cacheDir)}${snapshotDir ? ` (snapshot ${display(snapshotDir)})` : ''}`,
  );

  const failures: { id: string; error: string }[] = [];
  const skipped: string[] = [];
  let fetched = 0;
  let fresh = 0;
  const mirrored: { id: string; mirror: number }[] = [];

  await pool(lists, snapshotDir ? 1 : CONCURRENCY, async (list) => {
    if (snapshotDir) {
      const ok = await copySnapshot(snapshotDir, cacheDir, list);
      if (ok) {
        fetched++;
        console.info(`  ✓ ${list.id} (snapshot)`);
      } else {
        skipped.push(list.id);
        console.warn(`  – ${list.id}: not in snapshot, skipped`);
      }
      return;
    }
    if (!force && (await isFresh(cacheDir, list.id))) {
      fresh++;
      console.info(`  = ${list.id} (cached)`);
      return;
    }
    try {
      const { text, meta } = await fetchList(list);
      await writeList(cacheDir, list.id, text, meta);
      fetched++;
      if (meta.mirror !== null) mirrored.push({ id: list.id, mirror: meta.mirror });
      console.info(
        `  ✓ ${list.id} (${meta.sources.length} source(s), ${(Buffer.byteLength(text) / 1024).toFixed(0)} KiB, ${setLabel(meta.mirror)})`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ id: list.id, error: message });
      console.error(`  ✗ ${list.id}: ${message}`);
    }
  });

  console.info(
    `fetch-lists: ${fetched} written, ${fresh} cached, ${skipped.length} skipped, ${failures.length} failed, ${mirrored.length} via mirror`,
  );
  if (mirrored.length > 0) {
    console.warn('fetch-lists: the following lists came from a mirror, not their primary URLs:');
    for (const m of mirrored) console.warn(`  - ${m.id}: mirror ${m.mirror}`);
  }
  if (failures.length > 0) {
    console.error('fetch-lists: the following lists could not be fetched:');
    for (const f of failures) console.error(`  - ${f.id}: ${f.error}`);
    if (!allowMissing) {
      console.error('fetch-lists: re-run with --allow-missing to continue without them.');
      return 1;
    }
    console.warn('fetch-lists: continuing because --allow-missing was passed.');
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(`fetch-lists: ${err instanceof Error ? err.stack : String(err)}`);
      process.exitCode = 1;
    },
  );
}
