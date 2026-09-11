import { describe, expect, it } from 'vitest';
import type { DNRRule } from '@iublocker/shared';
import { ID_RANGE, PRIORITY } from '@iublocker/shared';
import type { RawLine } from '../src/types';
import { classifyLines } from '../src/parser/classify';
import { collectBadfilterKeys, compileNetwork } from '../src/network';
import type { CompileNetworkOptions } from '../src/network';

/**
 * The scriptlets package fills `redirectResources` in workstream T3; the compiler must
 * work against whatever table it is given, so the tests inject their own.
 */
const REDIRECTS: Record<string, string> = {
  'noop.js': 'noop.js',
  noopjs: 'noop.js',
  'noop.txt': 'noop.txt',
  empty: 'empty',
  '1x1.gif': '1x1.gif',
  '2x2.png': '2x2.png',
  'noop-1s.mp4': 'noop-1s.mp4',
  'googletagservices_gpt.js': 'googletagservices_gpt.js',
};

function lines(...raw: string[]): RawLine[] {
  return raw.map((r, i) => ({ line: i + 1, raw: r }));
}

function compile(raw: string[], opts: Partial<CompileNetworkOptions> = {}) {
  return compileNetwork(lines(...raw), {
    listId: 'test',
    trusted: false,
    redirectResources: REDIRECTS,
    ...opts,
  });
}

function onlyRule(raw: string, opts: Partial<CompileNetworkOptions> = {}): DNRRule {
  const result = compile([raw], opts);
  expect(result.dropped, `unexpected drops for ${raw}`).toEqual([]);
  expect(result.rules).toHaveLength(1);
  return result.rules[0] as DNRRule;
}

describe('docs/FILTER-SYNTAX.md §7 validation examples', () => {
  it('||ads.example.com^', () => {
    expect(onlyRule('||ads.example.com^')).toEqual({
      id: 1,
      priority: PRIORITY.BLOCK,
      action: { type: 'block' },
      condition: { requestDomains: ['ads.example.com'], excludedResourceTypes: ['main_frame'] },
    });
  });

  it('||example.com/banner/*$image,3p', () => {
    expect(onlyRule('||example.com/banner/*$image,3p')).toEqual({
      id: 1,
      priority: PRIORITY.BLOCK,
      action: { type: 'block' },
      condition: {
        urlFilter: '||example.com/banner/*',
        domainType: 'thirdParty',
        resourceTypes: ['image'],
      },
    });
  });

  it('@@||cdn.example.com^$script,domain=site.com', () => {
    expect(onlyRule('@@||cdn.example.com^$script,domain=site.com')).toEqual({
      id: 1,
      priority: PRIORITY.ALLOW,
      action: { type: 'allow' },
      condition: {
        requestDomains: ['cdn.example.com'],
        initiatorDomains: ['site.com'],
        resourceTypes: ['script'],
      },
    });
  });

  it('||tracker.com^$important', () => {
    expect(onlyRule('||tracker.com^$important')).toEqual({
      id: 1,
      priority: PRIORITY.IMPORTANT,
      action: { type: 'block' },
      condition: { requestDomains: ['tracker.com'], excludedResourceTypes: ['main_frame'] },
    });
  });

  it('||example.com/ads.js$redirect=noop.js', () => {
    expect(onlyRule('||example.com/ads.js$redirect=noop.js')).toEqual({
      id: 1,
      priority: PRIORITY.BLOCK,
      action: { type: 'redirect', redirect: { extensionPath: '/resources/noop.js' } },
      condition: { urlFilter: '||example.com/ads.js', excludedResourceTypes: ['main_frame'] },
    });
  });

  it('$removeparam=utm_source', () => {
    expect(onlyRule('$removeparam=utm_source')).toEqual({
      id: 1,
      priority: PRIORITY.BLOCK,
      action: {
        type: 'redirect',
        redirect: { transform: { queryTransform: { removeParams: ['utm_source'] } } },
      },
      condition: { excludedResourceTypes: ['main_frame'] },
    });
  });

  it("||site.com^$csp=script-src 'none'", () => {
    expect(onlyRule("||site.com^$csp=script-src 'none'")).toEqual({
      id: 1,
      priority: PRIORITY.BLOCK,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'Content-Security-Policy', operation: 'append', value: "script-src 'none'" },
        ],
      },
      condition: { requestDomains: ['site.com'], resourceTypes: ['main_frame', 'sub_frame'] },
    });
  });

  it('/^https?:\\/\\/[a-z]+\\.ad\\.example\\.com\\//', () => {
    expect(onlyRule('/^https?:\\/\\/[a-z]+\\.ad\\.example\\.com\\//')).toEqual({
      id: 1,
      priority: PRIORITY.BLOCK,
      action: { type: 'block' },
      condition: {
        regexFilter: '^https?:\\/\\/[a-z]+\\.ad\\.example\\.com\\/',
        excludedResourceTypes: ['main_frame'],
      },
    });
  });

  it('||example.com^$popup is dropped with a warning', () => {
    const result = compile(['||example.com^$popup']);
    expect(result.rules).toEqual([]);
    expect(result.dropped).toEqual([
      { listId: 'test', line: 1, raw: '||example.com^$popup', reason: 'unsupported option "popup"' },
    ]);
  });
});

describe('actions', () => {
  it('@@…$document becomes allowAllRequests', () => {
    expect(onlyRule('@@||example.com^$document')).toEqual({
      id: 1,
      priority: PRIORITY.DOCUMENT_ALLOW,
      action: { type: 'allowAllRequests' },
      condition: { requestDomains: ['example.com'], resourceTypes: ['main_frame', 'sub_frame'] },
    });
  });

  it('$empty and $mp4 map to redirects', () => {
    expect(onlyRule('||example.com/x.js$empty').action).toEqual({
      type: 'redirect',
      redirect: { extensionPath: '/resources/empty' },
    });
    const mp4 = onlyRule('||example.com/v$mp4');
    expect(mp4.action).toEqual({ type: 'redirect', redirect: { extensionPath: '/resources/noop-1s.mp4' } });
    expect(mp4.condition.resourceTypes).toEqual(['media']);
  });

  it('unknown redirect resources are dropped', () => {
    const result = compile(['||example.com/x.js$redirect=nope.js']);
    expect(result.rules).toEqual([]);
    expect(result.dropped[0]?.reason).toContain('unknown $redirect resource');
  });

  it('$redirect-rule only emits when a matching block exists', () => {
    const without = compile(['||example.com/a.js$redirect-rule=noop.js']);
    expect(without.rules).toEqual([]);
    expect(without.dropped[0]?.reason).toContain('$redirect-rule');

    const withBlock = compile(['||example.com/a.js', '||example.com/a.js$redirect-rule=noop.js']);
    expect(withBlock.rules).toHaveLength(2);
    expect(withBlock.rules[1]?.action).toEqual({
      type: 'redirect',
      redirect: { extensionPath: '/resources/noop.js' },
    });
  });

  it('$removeheader removes response and request headers', () => {
    expect(onlyRule('||example.com^$removeheader=refresh').action).toEqual({
      type: 'modifyHeaders',
      responseHeaders: [{ header: 'refresh', operation: 'remove' }],
    });
    expect(onlyRule('||example.com^$removeheader=request:cookie').action).toEqual({
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'cookie', operation: 'remove' }],
    });
  });

  it('$removeheader on a forbidden header is dropped', () => {
    const result = compile(['||example.com^$removeheader=origin']);
    expect(result.rules).toEqual([]);
    expect(result.dropped[0]?.reason).toContain('forbids modifying');
  });

  it('$permissions appends Permissions-Policy', () => {
    expect(onlyRule('||example.com^$permissions=autoplay=()').action).toEqual({
      type: 'modifyHeaders',
      responseHeaders: [{ header: 'Permissions-Policy', operation: 'append', value: 'autoplay=()' }],
    });
  });

  it('$header becomes a responseHeaders condition', () => {
    expect(onlyRule('||example.com^$header=content-type:text/html').condition.responseHeaders).toEqual([
      { header: 'content-type', values: ['text/html'] },
    ]);
    expect(onlyRule('||example.com^$~header=x-foo').condition.excludedResponseHeaders).toEqual([
      { header: 'x-foo' },
    ]);
  });

  it('$match-case sets isUrlFilterCaseSensitive', () => {
    expect(onlyRule('||example.com/AdBox$match-case').condition.isUrlFilterCaseSensitive).toBe(true);
    expect(onlyRule('||example.com/AdBox').condition.isUrlFilterCaseSensitive).toBeUndefined();
  });

  it('$method maps to requestMethods', () => {
    const rule = onlyRule('||example.com^$method=get|~post');
    expect(rule.condition.requestMethods).toEqual(['get']);
    expect(rule.condition.excludedRequestMethods).toEqual(['post']);
  });

  it('$denyallow becomes excludedRequestDomains', () => {
    const rule = onlyRule('||example.com/x$denyallow=ok.example,domain=site.example');
    expect(rule.condition.excludedRequestDomains).toEqual(['ok.example']);
    expect(rule.condition.initiatorDomains).toEqual(['site.example']);
  });

  it('$to fills requestDomains and forces a urlFilter for the pattern', () => {
    const rule = onlyRule('||example.com/lib.js$to=cdn.example');
    expect(rule.condition.requestDomains).toEqual(['cdn.example']);
    expect(rule.condition.urlFilter).toBe('||example.com/lib.js');
  });
});

describe('resource types', () => {
  it('defaults to everything but main_frame', () => {
    expect(onlyRule('||example.com^').condition).toEqual({
      requestDomains: ['example.com'],
      excludedResourceTypes: ['main_frame'],
    });
  });

  it('adds main_frame to explicit negations', () => {
    expect(onlyRule('||example.com^$~script').condition.excludedResourceTypes).toEqual([
      'main_frame',
      'script',
    ]);
  });

  it('$document blocks main_frame', () => {
    expect(onlyRule('||example.com^$document').condition.resourceTypes).toEqual(['main_frame']);
  });

  it('$all covers every type', () => {
    expect(onlyRule('||example.com^$all').condition.resourceTypes).toHaveLength(15);
  });
});

describe('$badfilter', () => {
  it('removes the matching filter within a list', () => {
    const result = compile(['||example.com^$script', '||example.com^$script,badfilter', '||other.com^']);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.condition.requestDomains).toEqual(['other.com']);
    expect(result.dropped[0]?.reason).toBe('removed by $badfilter');
  });

  it('does not remove filters with different options', () => {
    const result = compile(['||example.com^$script', '||example.com^$image,badfilter']);
    expect(result.rules).toHaveLength(1);
  });

  it('applies keys contributed by other lists', () => {
    const keys = collectBadfilterKeys(['||example.com^$script,badfilter']);
    const result = compile(['||example.com^$script'], { extraBadfilters: keys });
    expect(result.rules).toEqual([]);
  });
});

describe('dedupe, merge and shadowing', () => {
  it('drops exact duplicates', () => {
    const result = compile(['||a.example^$script', '||a.example^$script']);
    expect(result.rules).toHaveLength(1);
    expect(result.warnings).toContain('1 duplicate rules removed');
  });

  it('merges host rules with identical options into requestDomains', () => {
    const result = compile(['||a.example^', '||b.example^', '||c.example^']);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.condition.requestDomains).toEqual(['a.example', 'b.example', 'c.example']);
  });

  it('does not merge rules with different options', () => {
    const result = compile(['||a.example^', '||b.example^$script']);
    expect(result.rules).toHaveLength(2);
  });

  it('respects the domain cap', () => {
    const result = compile(['||a.example^', '||b.example^'], { maxDomainsPerRule: 1 });
    expect(result.rules).toHaveLength(2);
  });

  it('merges initiator domains for identical patterns', () => {
    const result = compile(['||ads.example/x$domain=one.example', '||ads.example/x$domain=two.example']);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.condition.initiatorDomains).toEqual(['one.example', 'two.example']);
  });

  it('drops rules shadowed by a broader domain rule', () => {
    const result = compile(['||ads.example^', '||ads.example/path/banner.js$script']);
    expect(result.rules).toHaveLength(1);
    expect(result.dropped.some((d) => d.reason.includes('shadowed'))).toBe(true);
  });

  it('keeps rules that are not provably shadowed', () => {
    const result = compile(['||ads.example^$script', '||ads.example/path/banner.gif$image']);
    expect(result.rules).toHaveLength(2);
  });

  it('does not treat an $important rule as shadowed by a plain one', () => {
    const result = compile(['||ads.example^', '||ads.example/x$important']);
    expect(result.rules).toHaveLength(2);
  });
});

describe('regex budget', () => {
  it('keeps only the first maxRegexRules regexes, in list order', () => {
    const result = compile(['/one\\d/', '/two\\d/', '/three\\d/'], { maxRegexRules: 2 });
    expect(result.counts.regex).toBe(2);
    expect(result.rules.map((r) => r.condition.regexFilter)).toEqual(['one\\d', 'two\\d']);
    expect(result.dropped[0]?.reason).toContain('regex budget exceeded');
  });

  it('drops regexes RE2 cannot compile', () => {
    const result = compile(['/(?=lookahead)/', '/(a)\\1/']);
    expect(result.rules).toEqual([]);
    expect(result.dropped).toHaveLength(2);
    expect(result.dropped[0]?.reason).toContain('lookahead');
    expect(result.dropped[1]?.reason).toContain('backreference');
  });
});

describe('cosmetic exceptions', () => {
  it('extracts hostnames from $elemhide/$generichide/$specifichide', () => {
    const result = compile([
      '@@||shop.example^$elemhide',
      '@@||news.example^$generichide',
      '@@||forum.example^$specifichide',
      '@@$specifichide,domain=other.example',
    ]);
    expect(result.rules).toEqual([]);
    expect(result.cosmeticExceptions).toEqual({
      elemhide: ['shop.example'],
      generichide: ['news.example'],
      specifichide: ['forum.example', 'other.example'],
    });
  });

  it('warns when the exception has no hostname', () => {
    const result = compile(['@@$elemhide']);
    expect(result.warnings.some((w) => w.includes('without a hostname'))).toBe(true);
  });
});

describe('ID allocation', () => {
  it('starts at 1 by default and increments', () => {
    const result = compile(['||a.example^$script', '||b.example^$image', '||c.example^$font']);
    expect(result.rules.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('honours firstRuleId', () => {
    const result = compile(['||a.example^$script', '||b.example^$image'], { firstRuleId: 5000 });
    expect(result.rules.map((r) => r.id)).toEqual([5000, 5001]);
  });

  it('uses the user range and tiers when priorityScope is user', () => {
    const result = compile(['||a.example^', '@@||b.example^', '||c.example^$important'], {
      priorityScope: 'user',
    });
    expect(result.rules.map((r) => r.id)).toEqual([
      ID_RANGE.USER.start,
      ID_RANGE.USER.start + 1,
      ID_RANGE.USER.start + 2,
    ]);
    expect(result.rules.map((r) => r.priority)).toEqual([
      PRIORITY.USER_BLOCK,
      PRIORITY.USER_ALLOW,
      PRIORITY.USER_IMPORTANT,
    ]);
  });

  it('drops rules once the id range is exhausted', () => {
    const result = compile(['||a.example^$script', '||b.example^$image'], {
      firstRuleId: 10,
      maxRuleId: 10,
    });
    expect(result.rules).toHaveLength(1);
    expect(result.dropped[0]?.reason).toBe('rule id range exhausted');
  });
});

describe('entity expansion', () => {
  it('prefers hostnames that occur in the list', () => {
    const rule = onlyRule('||ads.example^$domain=news.*', {});
    expect(rule.condition.initiatorDomains?.length).toBe(300);

    const result = compile(['||news.co.uk^$script', '||news.de^$script', '||ads.example^$domain=news.*']);
    const withEntity = result.rules.find((r) => r.condition.initiatorDomains !== undefined);
    expect(withEntity?.condition.initiatorDomains).toEqual(['news.co.uk', 'news.de']);
  });

  it('caps the fallback expansion', () => {
    const rule = onlyRule('||ads.example^$domain=news.*', { entityLimit: 5 });
    expect(rule.condition.initiatorDomains).toEqual([
      'news.com',
      'news.de',
      'news.net',
      'news.org',
      'news.uk',
    ]);
  });
});

describe('hosts-format lists', () => {
  it('compiles hosts lines into domain rules', () => {
    const classified = classifyLines('0.0.0.0 a.example.com\n0.0.0.0 b.example.com\n# comment', {
      format: 'hosts',
    });
    const result = compileNetwork(classified.network, {
      listId: 'hosts',
      trusted: false,
      hostsFormat: true,
      redirectResources: REDIRECTS,
    });
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.condition.requestDomains).toEqual(['a.example.com', 'b.example.com']);
  });

  it('accepts bare hostnames as domain rules in hosts format', () => {
    const result = compile(['bare.example.com'], { hostsFormat: true });
    expect(result.rules[0]?.condition.requestDomains).toEqual(['bare.example.com']);
  });
});
