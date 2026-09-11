import { describe, expect, it } from 'vitest';
import { ID_RANGE, PRIORITY } from '@iublocker/shared';
import { USER_LIST_ID, compileUserFilters } from '../src/user';

const OPTS = { trusted: false, allowTrustedScriptlets: false };

describe('compileUserFilters', () => {
  it('compiles network filters into dynamic rules in the user range', () => {
    const result = compileUserFilters('||ads.example.com^\n@@||safe.example.com^\n||x.example^$important', OPTS);
    expect(result.dnr.map((r) => r.id)).toEqual([
      ID_RANGE.USER.start,
      ID_RANGE.USER.start + 1,
      ID_RANGE.USER.start + 2,
    ]);
    expect(result.dnr.map((r) => r.priority)).toEqual([
      PRIORITY.USER_BLOCK,
      PRIORITY.USER_ALLOW,
      PRIORITY.USER_IMPORTANT,
    ]);
  });

  it('honours an explicit firstRuleId', () => {
    const result = compileUserFilters('||ads.example.com^', { ...OPTS, firstRuleId: 321_000 });
    expect(result.dnr[0]?.id).toBe(321_000);
  });

  it('returns empty DBs tagged with the user list id', () => {
    const result = compileUserFilters('||ads.example.com^', OPTS);
    expect(result.cosmetic.listId).toBe(USER_LIST_ID);
    expect(result.scriptlets.listId).toBe(USER_LIST_ID);
    expect(result.cosmetic.version).toBe(1);
    expect(result.scriptlets.version).toBe(1);
  });

  it('reports dropped filters as warnings with the line number', () => {
    const result = compileUserFilters('||ads.example.com^\n||bad.example.com^$popup', OPTS);
    expect(result.dnr).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes('line 2') && w.includes('popup'))).toBe(true);
  });

  it('warns about HTML filters', () => {
    const result = compileUserFilters('example.com##^div[ad]', OPTS);
    expect(result.warnings.some((w) => w.includes('HTML filtering'))).toBe(true);
  });

  it('records cosmetic network exceptions', () => {
    const result = compileUserFilters('@@||shop.example.com^$elemhide', OPTS);
    expect(result.dnr).toEqual([]);
    expect(result.cosmetic.exceptions.elemhide).toContain('shop.example.com');
  });

  it('handles an empty input', () => {
    const result = compileUserFilters('', OPTS);
    expect(result.dnr).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('never exceeds the user id range', () => {
    const types = ['script', 'image', 'font', 'media', 'ping'];
    const text = types.map((t, i) => `||h${i}.example^$${t}`).join('\n');
    const result = compileUserFilters(text, { ...OPTS, firstRuleId: ID_RANGE.USER.end - 1 });
    expect(result.dnr).toHaveLength(2);
    expect(result.dnr.every((r) => r.id <= ID_RANGE.USER.end)).toBe(true);
    expect(result.warnings.some((w) => w.includes('rule id range exhausted'))).toBe(true);
  });

  it('does not reference Node built-ins', async () => {
    const source = await import('node:fs').then(({ readFileSync }) =>
      readFileSync(new URL('../src/user.ts', import.meta.url), 'utf8'),
    );
    expect(source).not.toMatch(/from 'node:/);
  });
});
