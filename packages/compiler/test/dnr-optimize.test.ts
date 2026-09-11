import { describe, expect, it } from 'vitest';
import { PRIORITY } from '@iublocker/shared';
import type { ConvertedRule } from '../src/dnr/convert';
import { FORBIDDEN_MODIFY_HEADERS, STATIC_TIERS, USER_TIERS, toExtensionPath } from '../src/dnr/convert';
import { MAX_DOMAINS_PER_RULE, optimize, ruleKey } from '../src/dnr/optimize';
import { parseNetworkFilter } from '../src/parser/network-filter';

function entry(
  raw: string,
  rule: ConvertedRule['rule'],
  category: ConvertedRule['category'] = 'block',
): ConvertedRule {
  const parsed = parseNetworkFilter(raw, 1);
  if (!parsed.ok) throw new Error(parsed.reason);
  return { rule, filter: parsed.filter, isRegex: rule.condition.regexFilter !== undefined, category };
}

function block(
  domains: string[],
  extra: Record<string, unknown> = {},
  priority = PRIORITY.BLOCK,
): ConvertedRule['rule'] {
  return {
    priority,
    action: { type: 'block' },
    condition: { requestDomains: domains, excludedResourceTypes: ['main_frame'], ...extra },
  };
}

describe('toExtensionPath', () => {
  const cases: [string, string][] = [
    ['noop.js', '/resources/noop.js'],
    ['resources/noop.js', '/resources/noop.js'],
    ['/resources/noop.js', '/resources/noop.js'],
    ['//resources/1x1.gif', '/resources/1x1.gif'],
  ];
  for (const [input, expected] of cases) {
    it(`${input} → ${expected}`, () => {
      expect(toExtensionPath(input)).toBe(expected);
    });
  }
});

describe('priority tiers', () => {
  it('match the frozen constants', () => {
    expect(STATIC_TIERS).toEqual({
      block: PRIORITY.BLOCK,
      redirect: PRIORITY.REDIRECT,
      allow: PRIORITY.ALLOW,
      important: PRIORITY.IMPORTANT,
      importantRedirect: PRIORITY.IMPORTANT_REDIRECT,
      documentAllow: PRIORITY.DOCUMENT_ALLOW,
    });
    expect(USER_TIERS).toEqual({
      block: PRIORITY.USER_BLOCK,
      redirect: PRIORITY.USER_REDIRECT,
      allow: PRIORITY.USER_ALLOW,
      important: PRIORITY.USER_IMPORTANT,
      importantRedirect: PRIORITY.USER_IMPORTANT_REDIRECT,
      documentAllow: PRIORITY.USER_ALLOW,
    });
  });
});

describe('FORBIDDEN_MODIFY_HEADERS', () => {
  it('covers the CORS control headers', () => {
    expect(FORBIDDEN_MODIFY_HEADERS.has('origin')).toBe(true);
    expect(FORBIDDEN_MODIFY_HEADERS.has('access-control-allow-origin')).toBe(true);
    expect(FORBIDDEN_MODIFY_HEADERS.has('refresh')).toBe(false);
    expect(FORBIDDEN_MODIFY_HEADERS.has('set-cookie')).toBe(false);
  });
});

describe('ruleKey', () => {
  it('ignores property order', () => {
    const a = {
      priority: 1,
      action: { type: 'block' },
      condition: { requestDomains: ['a'], resourceTypes: ['script'] },
    };
    const b = {
      priority: 1,
      action: { type: 'block' },
      condition: { resourceTypes: ['script'], requestDomains: ['a'] },
    };
    expect(ruleKey(a as never)).toBe(ruleKey(b as never));
  });

  it('omits the requested field', () => {
    const a = { priority: 1, action: { type: 'block' }, condition: { requestDomains: ['a'] } };
    const b = { priority: 1, action: { type: 'block' }, condition: { requestDomains: ['b'] } };
    expect(ruleKey(a as never)).not.toBe(ruleKey(b as never));
    expect(ruleKey(a as never, 'requestDomains')).toBe(ruleKey(b as never, 'requestDomains'));
  });

  it('separates priorities and actions', () => {
    const a = { priority: 1, action: { type: 'block' }, condition: {} };
    const b = { priority: 2, action: { type: 'block' }, condition: {} };
    const c = { priority: 1, action: { type: 'allow' }, condition: {} };
    expect(ruleKey(a as never)).not.toBe(ruleKey(b as never));
    expect(ruleKey(a as never)).not.toBe(ruleKey(c as never));
  });
});

describe('optimize', () => {
  it('assigns ids and counts categories', () => {
    const result = optimize(
      [
        entry('||a.example^', block(['a.example'])),
        entry(
          '@@||b.example^',
          {
            priority: PRIORITY.ALLOW,
            action: { type: 'allow' },
            condition: { requestDomains: ['b.example'], excludedResourceTypes: ['main_frame'] },
          },
          'allow',
        ),
      ],
      { firstRuleId: 100, maxRegexRules: 1000 },
    );
    expect(result.rules.map((r) => r.id)).toEqual([100, 101]);
    expect(result.counts).toEqual({ regex: 0, redirect: 0, modifyHeaders: 0, allow: 1, block: 1 });
  });

  it('reports savings per step', () => {
    const result = optimize(
      [
        entry('||a.example^', block(['a.example'])),
        entry('||a.example^', block(['a.example'])),
        entry('||b.example^', block(['b.example'])),
      ],
      { firstRuleId: 1, maxRegexRules: 1000 },
    );
    expect(result.savings.duplicates).toBe(1);
    expect(result.savings.domainMerged).toBe(1);
    expect(result.rules).toHaveLength(1);
  });

  it('does not merge past the domain cap', () => {
    const many = Array.from({ length: 3 }, (_, i) => entry(`||h${i}.example^`, block([`h${i}.example`])));
    const merged = optimize([...many], { firstRuleId: 1, maxRegexRules: 1000 });
    expect(merged.rules).toHaveLength(1);

    const capped = optimize(
      Array.from({ length: 3 }, (_, i) => entry(`||h${i}.example^`, block([`h${i}.example`]))),
      { firstRuleId: 1, maxRegexRules: 1000, maxDomainsPerRule: 2 },
    );
    expect(capped.rules).toHaveLength(3);
  });

  it('exposes the default domain cap', () => {
    expect(MAX_DOMAINS_PER_RULE).toBe(5000);
  });

  it('never treats a regex rule as shadowed', () => {
    const result = optimize(
      [
        entry('||ads.example^', block(['ads.example'])),
        entry('/ads\\.example\\/x/', {
          priority: PRIORITY.BLOCK,
          action: { type: 'block' },
          condition: { regexFilter: 'ads\\.example\\/x', excludedResourceTypes: ['main_frame'] },
        }),
      ],
      { firstRuleId: 1, maxRegexRules: 1000 },
    );
    expect(result.rules).toHaveLength(2);
    expect(result.counts.regex).toBe(1);
  });

  it('does not shadow rules that can match main_frame', () => {
    const result = optimize(
      [
        entry('||ads.example^', block(['ads.example'])),
        entry('||ads.example/x$document', {
          priority: PRIORITY.BLOCK,
          action: { type: 'block' },
          condition: { urlFilter: '||ads.example/x', resourceTypes: ['main_frame'] },
        }),
      ],
      { firstRuleId: 1, maxRegexRules: 1000 },
    );
    expect(result.rules).toHaveLength(2);
  });

  it('does not shadow allow rules', () => {
    const result = optimize(
      [
        entry('||ads.example^', block(['ads.example'])),
        entry(
          '@@||ads.example/ok',
          {
            priority: PRIORITY.ALLOW,
            action: { type: 'allow' },
            condition: { urlFilter: '||ads.example/ok', excludedResourceTypes: ['main_frame'] },
          },
          'allow',
        ),
      ],
      { firstRuleId: 1, maxRegexRules: 1000 },
    );
    expect(result.rules).toHaveLength(2);
  });
});
