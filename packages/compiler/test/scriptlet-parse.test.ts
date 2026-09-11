import { describe, expect, it } from 'vitest';
import type { ParsedScriptlet } from '../src/scriptlet/parse';
import { parseScriptletFilter, splitScriptletArgs, stripJsSuffix } from '../src/scriptlet/parse';

function args(text: string): string[] {
  const res = splitScriptletArgs(text);
  if (!res.ok) throw new Error(`expected ${text} to split, got: ${res.reason}`);
  return res.value;
}

function ok(raw: string): ParsedScriptlet {
  const res = parseScriptletFilter(raw);
  if (res === null) throw new Error(`expected a scriptlet filter, got a skipped line: ${raw}`);
  if (!res.ok) throw new Error(`expected ${raw} to parse, got: ${res.reason}`);
  return res.value;
}

function err(raw: string): string {
  const res = parseScriptletFilter(raw);
  if (res === null) throw new Error(`expected a parse error, got a skipped line: ${raw}`);
  if (res.ok) throw new Error(`expected ${raw} to fail, got: ${JSON.stringify(res.value)}`);
  return res.reason;
}

describe('stripJsSuffix', () => {
  it('strips a trailing .js', () => {
    expect(stripJsSuffix('aopr.js')).toBe('aopr');
    expect(stripJsSuffix('aopr')).toBe('aopr');
    expect(stripJsSuffix('a.jsx')).toBe('a.jsx');
  });
});

describe('splitScriptletArgs', () => {
  const cases: [string, string[]][] = [
    ['', []],
    ['   ', []],
    ['name', ['name']],
    ['name, a, b', ['name', 'a', 'b']],
    ['  name ,  a  ,  b  ', ['name', 'a', 'b']],
    // escaped commas
    ['name, a\\,b, c', ['name', 'a,b', 'c']],
    ['name, a\\,b\\,c', ['name', 'a,b,c']],
    // quoted arguments
    ["name, 'a, b', c", ['name', 'a, b', 'c']],
    ['name, "a, b", c', ['name', 'a, b', 'c']],
    ["name, 'it\\'s', c", ['name', "it's", 'c']],
    ['name, "say \\"hi\\"", c', ['name', 'say "hi"', 'c']],
    ["name, 'a\\\\b'", ['name', 'a\\b']],
    ["name, ''", ['name', '']],
    ["name, '  padded  '", ['name', '  padded  ']],
    // regex arguments are kept verbatim
    ['name, /foo/', ['name', '/foo/']],
    ['name, /foo/i', ['name', '/foo/i']],
    ['name, /foo,bar/gi, 100', ['name', '/foo,bar/gi', '100']],
    ['name, /a\\/b/', ['name', '/a\\/b/']],
    ['name, /[a,b]/', ['name', '/[a,b]/']],
    // a "/" argument that is not a closed regex stays an ordinary argument
    ['name, /ads/banner.gif', ['name', '/ads/banner.gif']],
    ['name, /unterminated', ['name', '/unterminated']],
    // empty slots
    ['name,,b', ['name', '', 'b']],
    ['name,', ['name']],
    ['name, ', ['name']],
    // backslashes that are not comma escapes are preserved
    ['name, \\d+', ['name', '\\d+']],
    ["name, 'a\\d+b'", ['name', 'a\\d+b']],
  ];
  for (const [text, expected] of cases) {
    it(`splits ${JSON.stringify(text)}`, () => {
      expect(args(text)).toEqual(expected);
    });
  }

  it('rejects an unterminated quoted argument', () => {
    expect(splitScriptletArgs("name, 'abc")).toMatchObject({ ok: false });
  });

  it('rejects text after a quoted argument', () => {
    expect(splitScriptletArgs("name, 'abc'def")).toMatchObject({ ok: false });
  });
});

describe('parseScriptletFilter', () => {
  it('skips non-scriptlet lines', () => {
    expect(parseScriptletFilter('')).toBeNull();
    expect(parseScriptletFilter('! comment')).toBeNull();
    expect(parseScriptletFilter('[Adblock Plus 2.0]')).toBeNull();
    expect(parseScriptletFilter('||ads.example.com^')).toBeNull();
    expect(parseScriptletFilter('example.com##.ad')).toBeNull();
    expect(parseScriptletFilter('example.com#?#.a:has-text(x)')).toBeNull();
  });

  it('parses a call with arguments', () => {
    expect(ok('example.com##+js(set-constant, foo.bar, false)')).toMatchObject({
      domains: { include: ['example.com'], exclude: [] },
      exception: false,
      name: 'set-constant',
      args: ['foo.bar', 'false'],
    });
  });

  it('parses a call without arguments', () => {
    expect(ok('example.com##+js(noop)')).toMatchObject({ name: 'noop', args: [] });
  });

  it('strips a .js suffix from the name', () => {
    expect(ok('example.com##+js(aopr.js, foo)').name).toBe('aopr');
  });

  it('parses domains with negations and entities', () => {
    expect(ok('example.*,~sub.example.com##+js(noop)').domains).toEqual({
      include: ['example.*'],
      exclude: ['sub.example.com'],
    });
  });

  it('parses a generic call', () => {
    expect(ok('##+js(noop)').domains).toEqual({ include: [], exclude: [] });
  });

  it('parses an exception', () => {
    expect(ok('example.com#@#+js(set-constant)')).toMatchObject({
      exception: true,
      name: 'set-constant',
      args: [],
    });
  });

  it('parses "disable everything" exceptions', () => {
    expect(ok('example.com#@#+js()')).toMatchObject({ exception: true, name: '', args: [] });
  });

  it('keeps the raw body', () => {
    expect(ok('example.com##+js(noop)').raw).toBe('+js(noop)');
  });

  const invalid: [string, string][] = [
    ['example.com##+js()', 'missing scriptlet name'],
    ['example.com##+js(noop', 'unbalanced "("'],
    ['example.com##+js(noop) trailing', 'unbalanced "("'],
    ["example.com##+js(a, 'b)", 'unterminated quoted'],
    ["example.com##+js(a, 'b'c)", 'unexpected text after a quoted'],
    ['example.com#?#+js(noop)', '"+js()" is not allowed after "#?#"'],
    ['example.com#$#+js(noop)', '"+js()" is not allowed after "#$#"'],
    ['bad host##+js(noop)', 'invalid hostname'],
    ['example.com#%#//scriptlet("noop")', 'AdGuard'],
  ];
  for (const [raw, expected] of invalid) {
    it(`rejects ${raw}`, () => {
      expect(err(raw)).toContain(expected);
    });
  }
});

describe('backtick-quoted arguments (uBO)', () => {
  it('keeps commas inside backticks', () => {
    const r = splitScriptletArgs('replace-node-text, script, `a,b,c`, `x, y`');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(['replace-node-text', 'script', 'a,b,c', 'x, y']);
  });
});
