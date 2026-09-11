import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expandIncludes, fetchList, sha256 } from '../fetch-lists';
import { boolFlag, listFlag, parseArgs, stringFlag } from '../lib/args';
import type { FilterListSource } from '../../packages/shared/src/filterlists';

const BASE = 'https://lists.example.com/filters/main.txt';

function fetcherFrom(files: Record<string, string>): (url: string) => Promise<string> {
  return async (url: string) => {
    const body = files[url];
    if (body === undefined) throw new Error(`404 ${url}`);
    return body;
  };
}

describe('expandIncludes', () => {
  it('leaves text without includes untouched', async () => {
    const text = '||a.com^\n##.ad\n';
    const result = await expandIncludes(text, BASE, fetcherFrom({}));
    expect(result.text).toBe(text);
    expect(result.sources).toEqual([]);
  });

  it('resolves includes relative to the including source URL', async () => {
    const files = {
      'https://lists.example.com/filters/part1.txt': '||part1.example^',
      'https://lists.example.com/shared/part2.txt': '||part2.example^',
    };
    const text = '! head\n!#include part1.txt\n!#include ../shared/part2.txt\n! tail';
    const result = await expandIncludes(text, BASE, fetcherFrom(files));
    expect(result.text).toContain('! >>> source: https://lists.example.com/filters/part1.txt');
    expect(result.text).toContain('||part1.example^');
    expect(result.text).toContain('||part2.example^');
    expect(result.text.startsWith('! head')).toBe(true);
    expect(result.text.endsWith('! tail')).toBe(true);
    expect(result.sources.map((s) => s.url)).toEqual(Object.keys(files));
    expect(result.sources[0]?.sha256).toBe(sha256('||part1.example^'));
    expect(result.sources[0]?.bytes).toBe(16);
  });

  it('recurses but stops at depth 3', async () => {
    const files: Record<string, string> = {
      'https://lists.example.com/filters/l1.txt': '||l1.example^\n!#include l2.txt',
      'https://lists.example.com/filters/l2.txt': '||l2.example^\n!#include l3.txt',
      'https://lists.example.com/filters/l3.txt': '||l3.example^\n!#include l4.txt',
      'https://lists.example.com/filters/l4.txt': '||l4.example^',
    };
    const result = await expandIncludes('!#include l1.txt', BASE, fetcherFrom(files));
    expect(result.text).toContain('||l3.example^');
    expect(result.text).not.toContain('||l4.example^');
    expect(result.text).toContain('include depth limit reached');
    expect(result.sources).toHaveLength(3);
  });

  it('breaks include cycles', async () => {
    const files = {
      'https://lists.example.com/filters/a.txt': '||a.example^\n!#include b.txt',
      'https://lists.example.com/filters/b.txt': '||b.example^\n!#include a.txt',
    };
    const result = await expandIncludes('!#include a.txt', BASE, fetcherFrom(files));
    expect(result.text).toContain('||b.example^');
    expect(result.text).toContain('include cycle');
    expect(result.sources).toHaveLength(2);
  });

  it('turns a failed include into a comment instead of throwing', async () => {
    const result = await expandIncludes('||keep.example^\n!#include missing.txt', BASE, fetcherFrom({}));
    expect(result.text).toContain('||keep.example^');
    expect(result.text).toContain('! [iublocker] include failed');
  });
});

describe('parseArgs', () => {
  it('parses flags, values, equals form and positionals, ignoring a bare --', () => {
    const args = parseArgs(['--', 'old', 'new', '--out', 'delta.json', '--only=a,b', '--summary'], {
      boolean: ['summary'],
    });
    expect(args.positionals).toEqual(['old', 'new']);
    expect(stringFlag(args, 'out')).toBe('delta.json');
    expect(listFlag(args, 'only')).toEqual(['a', 'b']);
    expect(boolFlag(args, 'summary')).toBe(true);
    expect(boolFlag(args, 'force')).toBe(false);
  });

  it('treats a trailing value-less flag as boolean', () => {
    const args = parseArgs(['--cache', '.cache/lists', '--force']);
    expect(stringFlag(args, 'cache')).toBe('.cache/lists');
    expect(boolFlag(args, 'force')).toBe(true);
  });
});

describe('fetchList mirrors', () => {
  const base: Omit<FilterListSource, 'urls'> = {
    id: 'demo',
    title: 'Demo',
    group: 'ads',
    defaultEnabled: false,
  };

  function counting(files: Record<string, string>): {
    fetcher: (url: string) => Promise<string>;
    tried: string[];
  } {
    const tried: string[] = [];
    return {
      tried,
      fetcher: async (url: string) => {
        tried.push(url);
        const body = files[url];
        if (body === undefined) throw new Error(`HTTP 404 Not Found`);
        return body;
      },
    };
  }

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the primary urls and records mirror: null', async () => {
    const { fetcher, tried } = counting({ 'https://primary.example/a.txt': '||a.example^' });
    const { text, meta } = await fetchList(
      { ...base, urls: ['https://primary.example/a.txt'], mirrors: [['https://mirror.example/a.txt']] },
      fetcher,
    );
    expect(meta.mirror).toBe(null);
    expect(text).toContain('||a.example^');
    expect(meta.sources.map((s) => s.url)).toEqual(['https://primary.example/a.txt']);
    expect(tried).toEqual(['https://primary.example/a.txt']);
  });

  it('falls back to the first working mirror set and records its index', async () => {
    const { fetcher, tried } = counting({
      'https://mirror2.example/part1.txt': '||part1.example^',
      'https://mirror2.example/part2.txt': '||part2.example^',
    });
    const { text, meta } = await fetchList(
      {
        ...base,
        urls: ['https://dead.example/list.txt'],
        mirrors: [
          ['https://mirror1.example/list.txt'],
          ['https://mirror2.example/part1.txt', 'https://mirror2.example/part2.txt'],
        ],
      },
      fetcher,
    );
    expect(meta.mirror).toBe(1);
    expect(text).toContain('||part1.example^');
    expect(text).toContain('||part2.example^');
    expect(meta.sources.map((s) => s.url)).toEqual([
      'https://mirror2.example/part1.txt',
      'https://mirror2.example/part2.txt',
    ]);
    expect(tried).toEqual([
      'https://dead.example/list.txt',
      'https://mirror1.example/list.txt',
      'https://mirror2.example/part1.txt',
      'https://mirror2.example/part2.txt',
    ]);
  });

  it('rejects a mirror set when any of its urls fails, and moves to the next set', async () => {
    const { fetcher, tried } = counting({
      'https://mirror1.example/part1.txt': '||part1.example^',
      // part2 of mirror 0 is missing, so the whole set is unusable
      'https://mirror2.example/whole.txt': '||whole.example^',
    });
    const { text, meta } = await fetchList(
      {
        ...base,
        urls: ['https://dead.example/list.txt'],
        mirrors: [
          ['https://mirror1.example/part1.txt', 'https://mirror1.example/part2.txt'],
          ['https://mirror2.example/whole.txt'],
        ],
      },
      fetcher,
    );
    expect(meta.mirror).toBe(1);
    expect(text).toContain('||whole.example^');
    expect(text).not.toContain('||part1.example^');
    expect(meta.sources.map((s) => s.url)).toEqual(['https://mirror2.example/whole.txt']);
    expect(tried).toContain('https://mirror1.example/part2.txt');
  });

  it('expands includes inside a mirror and attributes them to the mirror source', async () => {
    const { fetcher } = counting({
      'https://mirror.example/list.txt': '! head\n!#include extra.txt',
      'https://mirror.example/extra.txt': '||extra.example^',
    });
    const { text, meta } = await fetchList(
      { ...base, urls: ['https://dead.example/list.txt'], mirrors: [['https://mirror.example/list.txt']] },
      fetcher,
    );
    expect(meta.mirror).toBe(0);
    expect(text).toContain('||extra.example^');
    expect(meta.sources.map((s) => s.url)).toEqual([
      'https://mirror.example/list.txt',
      'https://mirror.example/extra.txt',
    ]);
  });

  it('throws with every attempt in the message when the primary and all mirrors fail', async () => {
    const { fetcher } = counting({});
    await expect(
      fetchList(
        {
          ...base,
          urls: ['https://dead.example/list.txt'],
          mirrors: [['https://also-dead.example/list.txt']],
        },
        fetcher,
      ),
    ).rejects.toThrow(/primary: HTTP 404 Not Found; mirror 0: HTTP 404 Not Found/);
  });

  it('works for a list without mirrors', async () => {
    const { fetcher } = counting({ 'https://primary.example/a.txt': '||a.example^' });
    const { meta } = await fetchList({ ...base, urls: ['https://primary.example/a.txt'] }, fetcher);
    expect(meta.mirror).toBe(null);
    await expect(fetchList({ ...base, urls: ['https://gone.example/a.txt'] }, fetcher)).rejects.toThrow(
      /primary: HTTP 404 Not Found/,
    );
  });
});
