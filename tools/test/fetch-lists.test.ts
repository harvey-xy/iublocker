import { describe, expect, it } from 'vitest';
import { expandIncludes, sha256 } from '../fetch-lists';
import { boolFlag, listFlag, parseArgs, stringFlag } from '../lib/args';

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
