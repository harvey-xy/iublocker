// esbuild cannot run inside jsdom (its Uint8Array invariant fails across realms).
// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildManifest,
  buildRuleResources,
  parseArgs,
  runBuild,
  type ChromeManifest,
} from '../scripts/build';
import { makeListEntry, makeRulesetManifest } from './background-utils';

const temps: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'iub-build-'));
  temps.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(temps.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('build: argument parsing', () => {
  it('understands the documented flags', () => {
    expect(parseArgs(['--watch', '--minify', '--strict', '--skip-rulesets', '--e2e'])).toEqual({
      watch: true,
      minify: true,
      strict: true,
      skipRulesets: true,
      e2e: true,
    });
    expect(parseArgs(['--out', '/tmp/x'])).toEqual({ outDir: '/tmp/x' });
    expect(parseArgs(['--out=/tmp/y'])).toEqual({ outDir: '/tmp/y' });
  });
});

describe('build: rule_resources', () => {
  const manifest = makeRulesetManifest({
    lists: [
      makeListEntry('easylist', { defaultEnabled: true }),
      makeListEntry('easylist-de', { defaultEnabled: false }),
      makeListEntry('ghost', { defaultEnabled: true }),
    ],
  });
  const warn = () => undefined;
  const exists = (rel: string) => !rel.includes('ghost');

  it('maps every shipped list to rulesets/dnr/<id>.json with its default state', () => {
    const resources = buildRuleResources(manifest, { e2e: false, exists, warn });
    expect(resources).toEqual([
      { id: 'easylist', enabled: true, path: 'rulesets/dnr/easylist.json' },
      { id: 'easylist-de', enabled: false, path: 'rulesets/dnr/easylist-de.json' },
    ]);
  });

  it('drops lists whose rule file was not produced', () => {
    const warnings: string[] = [];
    buildRuleResources(manifest, { e2e: false, exists, warn: (m) => warnings.push(m) });
    expect(warnings[0]).toMatch(/ghost/);
  });

  it('adds the e2e ruleset when IUB_E2E is set', () => {
    const resources = buildRuleResources(manifest, { e2e: true, exists: () => true, warn });
    expect(resources.at(-1)).toEqual({ id: 'e2e-test', enabled: true, path: 'rulesets/dnr/e2e-test.json' });
  });

  it('only enables an already shipped e2e ruleset', () => {
    const withE2e = makeRulesetManifest({
      lists: [makeListEntry('e2e-test', { defaultEnabled: false, group: 'test' })],
    });
    const resources = buildRuleResources(withE2e, { e2e: true, exists: () => true, warn });
    expect(resources).toEqual([{ id: 'e2e-test', enabled: true, path: 'rulesets/dnr/e2e-test.json' }]);
  });

  it('tolerates a missing ruleset manifest', () => {
    expect(buildRuleResources(null, { e2e: false, exists: () => true, warn })).toEqual([]);
  });
});

describe('build: manifest generation', () => {
  it('drops content scripts whose bundle was not built', () => {
    const warnings: string[] = [];
    const manifest = buildManifest(
      '9.9.9',
      [],
      () => false,
      (m) => warnings.push(m),
    );
    expect(manifest.content_scripts).toBeUndefined();
    expect(warnings[0]).toMatch(/content\/cosmetic\.js/);
    expect(manifest.version).toBe('9.9.9');
  });

  it('keeps them when the file exists', () => {
    const manifest = buildManifest(
      '1.0.0',
      [],
      () => true,
      () => undefined,
    );
    expect(manifest.content_scripts?.[0]?.js).toEqual(['content/cosmetic.js']);
  });
});

describe('build: smoke test', () => {
  it('builds a loadable dist/ and never throws on missing entry points', async () => {
    const outDir = await tempDir();
    const result = await runBuild({ outDir, silent: true });

    expect(result.built).toContain('background.js');
    for (const file of result.built) expect(existsSync(path.join(outDir, file))).toBe(true);
    for (const file of result.skipped) expect(typeof file).toBe('string');

    const manifest = JSON.parse(await readFile(path.join(outDir, 'manifest.json'), 'utf8')) as ChromeManifest;
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Array.isArray(manifest.declarative_net_request?.rule_resources)).toBe(true);
    expect(manifest.permissions).toContain('declarativeNetRequest');

    const info = JSON.parse(await readFile(path.join(outDir, 'build-info.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(info).toMatchObject({ version: manifest.version, entries: result.built });
    expect(typeof info.gitSha).toBe('string');
    expect(typeof info.builtAt).toBe('string');

    // The service worker is an ES module without top-level await and without eval.
    const worker = await readFile(path.join(outDir, 'background.js'), 'utf8');
    expect(worker.split('\n').some((line) => /^await /.test(line))).toBe(false);
    expect(/new Function\s*\(/.test(worker)).toBe(false);
  }, 120_000);

  it('fails fast with --strict when the compiler output is missing', async () => {
    const outDir = await tempDir();
    const rulesets = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'rulesets');
    if (existsSync(rulesets)) return; // a real ruleset build is present; nothing to assert
    await expect(runBuild({ outDir, silent: true, strict: true })).rejects.toThrow(/rulesets/);
  }, 120_000);
});
