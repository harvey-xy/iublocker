import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RulesetListEntry, RulesetManifest, RulesetReport, DNRRule } from '@iublocker/shared';
import { BUILD_BUDGET, DNR_LIMITS } from '@iublocker/shared';
import { checkBudgets, parseArgs, rulesetVersion, runCli } from '../src/cli/index';

const FIXTURE = new URL('./fixtures/sample-list.txt', import.meta.url);
const SAMPLE = readFileSync(FIXTURE, 'utf8');

const HOSTS_LIST = [
  '# hosts fixture',
  '0.0.0.0 hosts-a.example.com',
  '0.0.0.0 hosts-b.example.com',
  '127.0.0.1 localhost',
  '',
].join('\n');

let root = '';
let cwd = '';
const logs: string[] = [];

function setup(): { lists: string; cache: string; out: string } {
  root = mkdtempSync(join(tmpdir(), 'iub-cli-'));
  const cache = join(root, 'cache');
  const out = join(root, 'out');
  mkdirSync(cache, { recursive: true });
  return { lists: join(root, 'lists.json'), cache, out };
}

function writeLists(path: string, lists: unknown[]): void {
  writeFileSync(path, JSON.stringify({ lists }));
}

beforeEach(() => {
  cwd = process.cwd();
  logs.length = 0;
  vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
    logs.push(args.join(' '));
  });
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    logs.push(args.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logs.push(args.join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(cwd);
  if (root !== '') rmSync(root, { recursive: true, force: true });
  root = '';
});

describe('parseArgs', () => {
  it('parses the documented flags', () => {
    const parsed = parseArgs([
      '--lists',
      'tools/filterlists.json',
      '--cache',
      '.cache/lists',
      '--out',
      'dist/rulesets',
      '--extra',
      'mine=/tmp/mine.txt',
      '--only',
      'a, b ,',
    ]);
    expect('options' in parsed).toBe(true);
    if (!('options' in parsed)) return;
    expect(parsed.options.lists).toBe('tools/filterlists.json');
    expect(parsed.options.cache).toBe('.cache/lists');
    expect(parsed.options.out).toBe('dist/rulesets');
    expect(parsed.options.extra).toEqual([{ id: 'mine', path: '/tmp/mine.txt' }]);
    expect(parsed.options.only).toEqual(['a', 'b']);
  });

  const errors: [string[], string][] = [
    [[], 'missing --lists'],
    [['--lists', 'a.json'], 'missing --cache'],
    [['--lists', 'a.json', '--cache', 'c'], 'missing --out'],
    [['--nope'], 'unknown argument "--nope"'],
    [['--extra', 'oops'], '--extra expects <listId>=<path>'],
  ];
  for (const [argv, expected] of errors) {
    it(`rejects ${argv.join(' ') || '<nothing>'}`, () => {
      const parsed = parseArgs(argv);
      expect('error' in parsed && parsed.error).toContain(expected);
    });
  }

  it('prints usage for --help', () => {
    expect(runCli(['--help'])).toBe(0);
    expect(logs.join('\n')).toContain('iub-compile');
  });
});

describe('rulesetVersion', () => {
  it('uses the newest fetchedAt', () => {
    expect(
      rulesetVersion([
        { url: 'a', sha256: 'x', fetchedAt: '2026-09-01T00:00:00.000Z' },
        { url: 'b', sha256: 'y', fetchedAt: '2026-09-11T12:00:00.000Z' },
      ]),
    ).toBe('2026.09.11.1');
  });

  it('accepts a build number', () => {
    expect(rulesetVersion([{ url: 'a', sha256: 'x', fetchedAt: '2026-01-02T00:00:00.000Z' }], 7)).toBe(
      '2026.01.02.7',
    );
  });

  it('falls back to today when timestamps are unusable', () => {
    expect(rulesetVersion([{ url: 'a', sha256: 'x', fetchedAt: 'not-a-date' }])).toMatch(
      /^\d{4}\.\d{2}\.\d{2}\.1$/,
    );
  });
});

describe('checkBudgets', () => {
  function entryWith(counts: Partial<RulesetListEntry['counts']>, defaultEnabled = true): RulesetListEntry {
    return {
      id: 'l',
      title: 'l',
      group: 'ads',
      defaultEnabled,
      trusted: false,
      sources: [],
      counts: {
        dnr: 0,
        regex: 0,
        cosmeticGeneric: 0,
        cosmeticSpecific: 0,
        procedural: 0,
        scriptlets: 0,
        dropped: 0,
        ...counts,
      },
      files: { dnr: 'a', cosmetic: 'b', scriptlets: 'c' },
    };
  }

  it('passes for a small build', () => {
    expect(checkBudgets([entryWith({ dnr: 10, regex: 2 })], 0)).toEqual([]);
  });

  it('fails when default-enabled lists blow the global budget', () => {
    const failures = checkBudgets([entryWith({ dnr: BUILD_BUDGET.STATIC_RULES_DEFAULT_ENABLED + 1 })], 0);
    expect(failures.join('\n')).toContain('default-enabled lists produce');
  });

  it('ignores disabled lists in the global budget', () => {
    const failures = checkBudgets(
      [entryWith({ dnr: BUILD_BUDGET.STATIC_RULES_DEFAULT_ENABLED + 1 }, false)],
      0,
    );
    expect(failures.join('\n')).not.toContain('default-enabled lists produce');
  });

  it('fails on the per-list budget', () => {
    const failures = checkBudgets([entryWith({ dnr: BUILD_BUDGET.STATIC_RULES_PER_LIST + 1 }, false)], 0);
    expect(failures.join('\n')).toContain('per-list budget');
  });

  it('fails on the regex budget', () => {
    const failures = checkBudgets([entryWith({ regex: DNR_LIMITS.MAX_REGEX_RULES_PER_RULESET + 1 })], 0);
    expect(failures.join('\n')).toContain('regex rules');
  });

  it('fails on the scriptlet bundle budget', () => {
    expect(checkBudgets([], BUILD_BUDGET.SCRIPTLET_GROUP_BYTES + 1).join('\n')).toContain(
      'scriptlet bundles',
    );
  });

  it('fails when too many rulesets are declared', () => {
    const many = Array.from({ length: DNR_LIMITS.MAX_STATIC_RULESETS + 1 }, () => entryWith({ dnr: 1 }));
    expect(checkBudgets(many, 0).join('\n')).toContain('rulesets declared');
  });
});

describe('runCli', () => {
  it('compiles a list and writes the documented output layout', () => {
    const { lists, cache, out } = setup();
    writeLists(lists, [
      {
        id: 'sample',
        title: 'Sample List',
        urls: ['https://example.invalid/sample.txt'],
        group: 'ads',
        defaultEnabled: true,
        trusted: true,
        license: 'GPL-3.0-or-later',
      },
      {
        id: 'hosts-sample',
        title: 'Hosts Sample',
        urls: ['https://example.invalid/hosts.txt'],
        group: 'privacy',
        format: 'hosts',
        defaultEnabled: false,
        trusted: false,
      },
      { id: 'missing', title: 'Missing', urls: [], group: 'ads', defaultEnabled: false },
    ]);
    writeFileSync(join(cache, 'sample.txt'), SAMPLE);
    writeFileSync(
      join(cache, 'sample.meta.json'),
      JSON.stringify({
        sources: [
          {
            url: 'https://example.invalid/sample.txt',
            sha256: 'abc123',
            fetchedAt: '2026-09-11T09:00:00.000Z',
          },
        ],
      }),
    );
    writeFileSync(join(cache, 'hosts-sample.txt'), HOSTS_LIST);

    expect(runCli(['--lists', lists, '--cache', cache, '--out', out])).toBe(0);

    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as RulesetManifest;
    expect(manifest.version).toBe('2026.09.11.1');
    expect(new Date(manifest.builtAt).toString()).not.toBe('Invalid Date');
    expect(manifest.lists.map((l) => l.id)).toEqual(['sample', 'hosts-sample']);

    const sample = manifest.lists[0] as RulesetListEntry;
    expect(sample.title).toBe('iuBlocker compiler sample list');
    expect(sample.trusted).toBe(true);
    expect(sample.license).toBe('GPL-3.0-or-later');
    expect(sample.files).toEqual({
      dnr: 'dnr/sample.json',
      cosmetic: 'cosmetic/sample.json',
      scriptlets: 'scriptlets/sample.json',
    });
    expect(sample.sources).toEqual([
      { url: 'https://example.invalid/sample.txt', sha256: 'abc123', fetchedAt: '2026-09-11T09:00:00.000Z' },
    ]);
    expect(sample.counts.dnr).toBeGreaterThan(20);
    expect(sample.counts.dropped).toBeGreaterThan(0);

    // meta.json is optional: the sha256 is computed from the text instead.
    const hosts = manifest.lists[1] as RulesetListEntry;
    expect(hosts.sources[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(hosts.sources[0]?.url).toBe('https://example.invalid/hosts.txt');

    expect(manifest.budget.staticRulesTotal).toBe(sample.counts.dnr + hosts.counts.dnr);
    expect(manifest.budget.staticRulesDefaultEnabled).toBe(sample.counts.dnr);

    const rules = JSON.parse(readFileSync(join(out, 'dnr/sample.json'), 'utf8')) as DNRRule[];
    expect(rules.length).toBe(sample.counts.dnr);
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
    expect(rules.every((r) => r.id >= 1 && r.id <= 299_999)).toBe(true);

    const hostsRules = JSON.parse(readFileSync(join(out, 'dnr/hosts-sample.json'), 'utf8')) as DNRRule[];
    expect(hostsRules[0]?.condition.requestDomains).toEqual(['hosts-a.example.com', 'hosts-b.example.com']);
    // Rule ids are unique *per ruleset* and every list numbers from 1
    // (docs/FILTER-SYNTAX.md §6) — they are deliberately NOT globally unique.
    expect(new Set(hostsRules.map((r) => r.id)).size).toBe(hostsRules.length);
    expect(Math.min(...hostsRules.map((r) => r.id))).toBe(1);
    expect(Math.min(...rules.map((r) => r.id))).toBe(1);

    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) as RulesetReport;
    expect(report.version).toBe(manifest.version);
    expect(Object.keys(report.lists)).toEqual(['sample', 'hosts-sample']);
    expect(report.dropped.some((d) => d.reason.includes('popup'))).toBe(true);
    expect(report.dropped.some((d) => d.reason.includes('HTML filtering'))).toBe(true);
    expect(report.dropped.every((d) => d.line > 0 && d.raw !== '')).toBe(true);

    // Cosmetic/scriptlet DBs always exist, even before T2 lands.
    const cosmetic = JSON.parse(readFileSync(join(out, 'cosmetic/sample.json'), 'utf8')) as {
      listId: string;
      exceptions: { elemhide: string[]; generichide: string[]; specifichide: string[] };
    };
    expect(cosmetic.listId).toBe('sample');
    expect(cosmetic.exceptions.elemhide).toContain('shop.example.com');
    expect(cosmetic.exceptions.generichide).toContain('news.example.com');
    expect(cosmetic.exceptions.specifichide).toContain('forum.example.com');
    expect(JSON.parse(readFileSync(join(out, 'scriptlets/sample.json'), 'utf8')).listId).toBe('sample');

    const summary = logs.join('\n');
    expect(summary).toContain('sample');
    expect(summary).toContain('version 2026.09.11.1');
    expect(summary).toContain('no cached list at');
  });

  it('honours --only and --extra', () => {
    const { lists, cache, out } = setup();
    writeLists(lists, [
      { id: 'sample', title: 'Sample', urls: [], group: 'ads', defaultEnabled: true },
      { id: 'other', title: 'Other', urls: [], group: 'ads', defaultEnabled: true },
    ]);
    writeFileSync(join(cache, 'sample.txt'), SAMPLE);
    writeFileSync(join(cache, 'other.txt'), '||other.example.com^\n');
    const extraPath = join(root, 'extra.txt');
    writeFileSync(extraPath, '||extra.example.com^\n');

    expect(
      runCli([
        '--lists',
        lists,
        '--cache',
        cache,
        '--out',
        out,
        '--only',
        'other,mine',
        '--extra',
        `mine=${extraPath}`,
      ]),
    ).toBe(0);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as RulesetManifest;
    expect(manifest.lists.map((l) => l.id)).toEqual(['other', 'mine']);
    expect(manifest.lists[1]?.group).toBe('custom');
    expect(manifest.lists[1]?.defaultEnabled).toBe(false);
  });

  it('compiles the e2e list when IUB_E2E=1', () => {
    const { lists, cache, out } = setup();
    writeLists(lists, []);
    const repoRoot = join(root, 'repo');
    mkdirSync(join(repoRoot, 'e2e/fixtures'), { recursive: true });
    writeFileSync(
      join(repoRoot, 'e2e/fixtures/test-list.txt'),
      ['||127.0.0.1/ads/^', '127.0.0.1##.ad-banner', '$removeparam=utm_source', ''].join('\n'),
    );
    process.chdir(repoRoot);
    vi.stubEnv('IUB_E2E', '1');
    try {
      expect(runCli(['--lists', lists, '--cache', cache, '--out', out])).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as RulesetManifest;
    expect(manifest.lists.map((l) => l.id)).toEqual(['e2e-test']);
    expect(manifest.lists[0]?.group).toBe('test');
    expect(manifest.lists[0]?.trusted).toBe(true);
    expect(manifest.lists[0]?.defaultEnabled).toBe(true);
  });

  it('fails with exit code 1 when a budget is exceeded', () => {
    const { lists, cache, out } = setup();
    const count = DNR_LIMITS.MAX_STATIC_RULESETS + 1;
    const entries = Array.from({ length: count }, (_, i) => ({
      id: `list-${i}`,
      title: `List ${i}`,
      urls: [],
      group: 'ads',
      defaultEnabled: false,
    }));
    writeLists(lists, entries);
    for (let i = 0; i < count; i += 1) writeFileSync(join(cache, `list-${i}.txt`), `||host${i}.example^\n`);

    expect(runCli(['--lists', lists, '--cache', cache, '--out', out])).toBe(1);
    expect(logs.join('\n')).toContain('build budget exceeded');
    expect(logs.join('\n')).toContain('rulesets declared');
  });

  it('fails with exit code 2 on bad input', () => {
    const { lists, cache, out } = setup();
    expect(runCli(['--lists', join(root, 'nope.json'), '--cache', cache, '--out', out])).toBe(2);
    expect(logs.join('\n')).toContain('--lists file not found');

    writeLists(lists, []);
    expect(runCli(['--lists', lists, '--cache', cache, '--out', out])).toBe(2);
    expect(logs.join('\n')).toContain('nothing to compile');

    expect(
      runCli(['--lists', lists, '--cache', cache, '--out', out, '--extra', `gone=${join(root, 'gone.txt')}`]),
    ).toBe(2);
    expect(logs.join('\n')).toContain('list file not found');
  });

  it('recovers from a corrupt meta file', () => {
    const { lists, cache, out } = setup();
    writeLists(lists, [
      {
        id: 'sample',
        title: 'Sample',
        urls: ['https://x.invalid/a.txt'],
        group: 'ads',
        defaultEnabled: true,
      },
    ]);
    writeFileSync(join(cache, 'sample.txt'), '||ads.example.com^\n');
    writeFileSync(join(cache, 'sample.meta.json'), 'not json');
    expect(runCli(['--lists', lists, '--cache', cache, '--out', out])).toBe(0);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as RulesetManifest;
    expect(manifest.lists[0]?.sources[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('applies $badfilter across lists in the same build', () => {
    const { lists, cache, out } = setup();
    writeLists(lists, [
      { id: 'a', title: 'A', urls: [], group: 'ads', defaultEnabled: true },
      { id: 'b', title: 'B', urls: [], group: 'ads', defaultEnabled: true },
    ]);
    writeFileSync(join(cache, 'a.txt'), '||cross.example.com^$script\n');
    writeFileSync(join(cache, 'b.txt'), '||cross.example.com^$script,badfilter\n');
    expect(runCli(['--lists', lists, '--cache', cache, '--out', out])).toBe(0);
    const rules = JSON.parse(readFileSync(join(out, 'dnr/a.json'), 'utf8')) as DNRRule[];
    expect(rules).toEqual([]);
  });
});

describe('runCli — scriptlet libs and groups (docs/RULESETS.md §2)', () => {
  function build(): { out: string } {
    const { lists, cache, out } = setup();
    writeLists(lists, [{ id: 'sample', title: 'Sample', urls: [], group: 'ads', defaultEnabled: true }]);
    writeFileSync(join(cache, 'sample.txt'), SAMPLE);
    expect(runCli(['--lists', lists, '--cache', cache, '--out', out])).toBe(0);
    return { out };
  }

  it('writes one lib file per scriptlet name and one tiny file per group', () => {
    const { out } = build();
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as RulesetManifest;
    expect(manifest.scriptletGroups.length).toBeGreaterThan(0);

    const libDir = join(out, 'scriptlet-lib');
    expect(existsSync(libDir)).toBe(true);
    const libs = readdirSync(libDir);
    expect(libs.length).toBeGreaterThan(0);

    for (const group of manifest.scriptletGroups) {
      // Every lib the manifest promises exists on disk and is referenced by path.
      expect(group.libs.length).toBeGreaterThan(0);
      for (const lib of group.libs) {
        expect(lib.startsWith('scriptlet-lib/')).toBe(true);
        expect(existsSync(join(out, lib))).toBe(true);
      }
      const source = readFileSync(join(out, group.file), 'utf8');
      expect(source).toContain('self.__iub_lib');
      // The call list only, so it stays far smaller than any scriptlet body.
      expect(source.length).toBeLessThan(2_000);
    }
  });

  it('defines the scriptlet on self.__iub_lib in the lib file', () => {
    const { out } = build();
    const name = readdirSync(join(out, 'scriptlet-lib'))[0] as string;
    const source = readFileSync(join(out, 'scriptlet-lib', name), 'utf8');
    expect(source).toContain('self.__iub_lib');
    expect(source).toContain(JSON.stringify(name.replace(/\.js$/, '')));
    // The whole point: the function body lives here, not in the group files.
    expect(source.length).toBeGreaterThan(200);
  });

  it('reports lib and group bytes separately in the summary', () => {
    build();
    expect(logs.join('\n')).toMatch(/scriptlets · \d+ lib files \(\d+ B\) · \d+ groups \(\d+ B\)/);
  });

  it('clears scriptlet-lib/ between builds', () => {
    const { lists, cache, out } = setup();
    writeLists(lists, [{ id: 'sample', title: 'Sample', urls: [], group: 'ads', defaultEnabled: true }]);
    writeFileSync(join(cache, 'sample.txt'), SAMPLE);
    expect(runCli(['--lists', lists, '--cache', cache, '--out', out])).toBe(0);
    writeFileSync(join(out, 'scriptlet-lib', 'stale.js'), '// stale');
    expect(runCli(['--lists', lists, '--cache', cache, '--out', out])).toBe(0);
    expect(existsSync(join(out, 'scriptlet-lib', 'stale.js'))).toBe(false);
  });

  it('numbers every ruleset from 1', () => {
    const { lists, cache, out } = setup();
    writeLists(lists, [
      { id: 'a', title: 'A', urls: [], group: 'ads', defaultEnabled: true },
      { id: 'b', title: 'B', urls: [], group: 'ads', defaultEnabled: true },
    ]);
    writeFileSync(join(cache, 'a.txt'), '||a1.example^$script\n||a2.example^$image\n');
    writeFileSync(join(cache, 'b.txt'), '||b1.example^$script\n||b2.example^$image\n');
    expect(runCli(['--lists', lists, '--cache', cache, '--out', out])).toBe(0);
    const a = JSON.parse(readFileSync(join(out, 'dnr/a.json'), 'utf8')) as DNRRule[];
    const b = JSON.parse(readFileSync(join(out, 'dnr/b.json'), 'utf8')) as DNRRule[];
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
    expect(Math.min(...a.map((r) => r.id))).toBe(1);
  });
});
