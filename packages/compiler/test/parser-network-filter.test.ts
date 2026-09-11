import { describe, expect, it } from 'vitest';
import type { NetworkFilter } from '../src/parser/network-filter';
import {
  badfilterKey,
  parseNetworkFilter,
  splitOptionList,
  splitPatternOptions,
  toASCIIHostname,
} from '../src/parser/network-filter';

function parse(raw: string, hostsFormat = false): NetworkFilter {
  const result = parseNetworkFilter(raw, 1, { hostsFormat });
  if (!result.ok) throw new Error(`expected "${raw}" to parse, got: ${result.reason}`);
  return result.filter;
}

function reason(raw: string): string {
  const result = parseNetworkFilter(raw, 1);
  if (result.ok) throw new Error(`expected "${raw}" to be rejected`);
  return result.reason;
}

describe('splitPatternOptions', () => {
  const cases: [string, string, string | null][] = [
    ['||example.com^', '||example.com^', null],
    ['||example.com^$script', '||example.com^', 'script'],
    ['/ads?[0-9]+\\.js/', '/ads?[0-9]+\\.js/', null],
    ['/ads\\/x/$script,image', '/ads\\/x/', 'script,image'],
    ['/ads/banner$image', '/ads/banner', 'image'],
    ['||example.com/a\\$b^$script', '||example.com/a\\$b^', 'script'],
    ['$removeparam=utm_source', '', 'removeparam=utm_source'],
  ];
  for (const [input, pattern, options] of cases) {
    it(`splits ${input}`, () => {
      expect(splitPatternOptions(input)).toEqual({ pattern, options });
    });
  }
});

describe('splitOptionList', () => {
  it('splits on top-level commas', () => {
    expect(splitOptionList('script,image,third-party')).toEqual(['script', 'image', 'third-party']);
  });
  it('keeps commas inside regex values', () => {
    expect(splitOptionList('removeparam=/a,b/,script')).toEqual(['removeparam=/a,b/', 'script']);
  });
  it('keeps commas inside parentheses', () => {
    expect(splitOptionList('permissions=geolocation=(self "a"),script')).toEqual([
      'permissions=geolocation=(self "a")',
      'script',
    ]);
  });
});

describe('toASCIIHostname', () => {
  it('lowercases ASCII hostnames', () => {
    expect(toASCIIHostname('ADS.Example.COM')).toBe('ads.example.com');
  });
  it('punycodes IDN hostnames', () => {
    expect(toASCIIHostname('пример.рф')).toBe('xn--e1afmkfd.xn--p1ai');
  });
});

describe('pattern forms', () => {
  it('||host^ is host-anchored', () => {
    const f = parse('||ads.example.com^');
    expect(f.kind).toBe('hostAnchor');
    expect(f.hostname).toBe('ads.example.com');
    expect(f.hostRest).toBe('^');
    expect(f.isException).toBe(false);
  });

  it('||host/path keeps the remainder', () => {
    const f = parse('||example.com/banner/*');
    expect(f.kind).toBe('hostAnchor');
    expect(f.hostname).toBe('example.com');
    expect(f.hostRest).toBe('/banner/*');
  });

  it('punycodes anchored IDN hostnames', () => {
    expect(parse('||пример.рф^').hostname).toBe('xn--e1afmkfd.xn--p1ai');
  });

  it('|scheme anchors on the left', () => {
    const f = parse('|https://ads.example.com/');
    expect(f.leftAnchored).toBe(true);
    expect(f.kind).toBe('text');
  });

  it('trailing | anchors on the right', () => {
    const f = parse('||example.org/track.gif|');
    expect(f.rightAnchored).toBe(true);
    expect(f.hostRest).toBe('/track.gif');
  });

  it('/regex/ is a regex pattern', () => {
    const f = parse('/ads?[0-9]+\\.js/');
    expect(f.kind).toBe('regex');
    expect(f.regex).toBe('ads?[0-9]+\\.js');
  });

  it('plain text patterns stay plain', () => {
    expect(parse('-advertisement-icon.').kind).toBe('text');
  });

  it('bare hostnames become host rules only in hosts format', () => {
    expect(parse('ads.example.com', true).kind).toBe('hostname');
    expect(parse('ads.example.com', false).kind).toBe('text');
  });

  it('@@ marks exceptions', () => {
    expect(parse('@@||example.com^').isException).toBe(true);
  });

  it('wildcard hosts fall back to a text pattern', () => {
    expect(parse('||*.example.com^').kind).toBe('text');
  });
});

describe('resource type options', () => {
  it('maps aliases to DNR resource types', () => {
    expect(parse('||a.com^$xhr').resourceTypes).toEqual(['xmlhttprequest']);
    expect(parse('||a.com^$frame').resourceTypes).toEqual(['sub_frame']);
    expect(parse('||a.com^$css').resourceTypes).toEqual(['stylesheet']);
    expect(parse('||a.com^$beacon').resourceTypes).toEqual(['ping']);
    expect(parse('||a.com^$doc').resourceTypes).toEqual(['main_frame']);
    expect(parse('||a.com^$object-subrequest').resourceTypes).toEqual(['object']);
  });

  it('collects negated types separately', () => {
    const f = parse('||a.com^$~script,~image');
    expect(f.resourceTypes).toEqual([]);
    expect(f.excludedResourceTypes).toEqual(['script', 'image']);
  });

  it('$all enables every type', () => {
    const f = parse('||a.com^$all');
    expect(f.isAll).toBe(true);
    expect(f.resourceTypes).toContain('main_frame');
    expect(f.resourceTypes).toContain('websocket');
  });

  it('$document sets hasDocument', () => {
    expect(parse('@@||a.com^$document').hasDocument).toBe(true);
  });
});

describe('party and domain options', () => {
  it('handles third/first party aliases', () => {
    expect(parse('||a.com^$third-party').domainType).toBe('thirdParty');
    expect(parse('||a.com^$3p').domainType).toBe('thirdParty');
    expect(parse('||a.com^$~third-party').domainType).toBe('firstParty');
    expect(parse('||a.com^$first-party').domainType).toBe('firstParty');
    expect(parse('||a.com^$1p').domainType).toBe('firstParty');
    expect(parse('||a.com^$~first-party').domainType).toBe('thirdParty');
  });

  it('splits $domain into included and excluded', () => {
    const f = parse('||a.com^$domain=x.com|~y.x.com');
    expect(f.initiator).toEqual({ included: ['x.com'], excluded: ['y.x.com'] });
  });

  it('$from is an alias of $domain', () => {
    expect(parse('||a.com^$from=x.com').initiator.included).toEqual(['x.com']);
  });

  it('keeps entity domains as `base.*`', () => {
    expect(parse('||a.com^$domain=example.*').initiator.included).toEqual(['example.*']);
  });

  it('drops regex domains', () => {
    const f = parse('||a.com^$domain=/bad/|good.com');
    expect(f.initiator.included).toEqual(['good.com']);
    expect(f.warnings.join(' ')).toContain('regex domain');
  });

  it('$to fills request domains, $denyallow fills denyAllow', () => {
    expect(parse('||a.com^$to=cdn.com').request.included).toEqual(['cdn.com']);
    expect(parse('||a.com^$denyallow=ok.com,domain=x.com').denyAllow).toEqual(['ok.com']);
  });

  it('$method splits positive and negated methods', () => {
    const f = parse('||a.com^$method=get|~post');
    expect(f.methods).toEqual(['get']);
    expect(f.excludedMethods).toEqual(['post']);
  });
});

describe('modifier options', () => {
  it('$match-case and $important', () => {
    expect(parse('||a.com/X$match-case').matchCase).toBe(true);
    expect(parse('||a.com^$important').important).toBe(true);
  });

  it('$badfilter is not part of the badfilter key', () => {
    const target = parse('||a.com^$script');
    const bad = parse('||a.com^$script,badfilter');
    expect(bad.badfilter).toBe(true);
    expect(badfilterKey(bad)).toBe(badfilterKey(target));
  });

  it('$redirect, $rewrite=abp-resource: and $redirect-rule', () => {
    expect(parse('||a.com/x.js$redirect=noop.js').redirect).toBe('noop.js');
    expect(parse('||a.com/x.js$rewrite=abp-resource:blank-js').redirect).toBe('blank-js');
    const rr = parse('||a.com/x.js$redirect-rule=noop.js');
    expect(rr.redirect).toBe('noop.js');
    expect(rr.redirectRule).toBe(true);
  });

  it('$redirect strips uBO priority suffixes', () => {
    expect(parse('||a.com/x.js$redirect=noop.js:10').redirect).toBe('noop.js');
  });

  it('$empty and $mp4 become redirects', () => {
    expect(parse('||a.com/x$empty').redirect).toBe('empty');
    const mp4 = parse('||a.com/x$mp4');
    expect(mp4.redirect).toBe('noop-1s.mp4');
    expect(mp4.resourceTypes).toEqual(['media']);
  });

  it('$removeparam accepts plain names only', () => {
    expect(parse('$removeparam=utm_source').removeParams).toEqual(['utm_source']);
    expect(parse('$removeparam=a|b').removeParams).toEqual(['a', 'b']);
    expect(reason('$removeparam')).toContain('without a name');
    expect(reason('$removeparam=~a')).toContain('negation');
    expect(reason('$removeparam=/utm_.*/')).toContain('regex');
  });

  it('$csp, $permissions', () => {
    expect(parse("||a.com^$csp=script-src 'none'").csp).toBe("script-src 'none'");
    expect(parse('||a.com^$permissions=autoplay=()').permissions).toBe('autoplay=()');
    expect(parse('@@||a.com^$csp').csp).toBe('');
    expect(reason('||a.com^$csp')).toContain('only valid on @@');
  });

  it('$removeheader knows request and response targets', () => {
    expect(parse('||a.com^$removeheader=refresh').removeHeader).toEqual({
      target: 'response',
      name: 'refresh',
    });
    expect(parse('||a.com^$removeheader=request:cookie').removeHeader).toEqual({
      target: 'request',
      name: 'cookie',
    });
    expect(reason('||a.com^$removeheader')).toContain('no name');
  });

  it('$header parses name and optional value', () => {
    expect(parse('||a.com^$header=content-type').header).toEqual({ name: 'content-type', negated: false });
    expect(parse('||a.com^$header=content-type:text/html').header).toEqual({
      name: 'content-type',
      value: 'text/html',
      negated: false,
    });
    expect(parse('||a.com^$~header=x-foo').header?.negated).toBe(true);
  });

  it('cosmetic-only options are recorded', () => {
    expect(parse('@@||a.com^$elemhide').cosmeticOptions).toEqual(['elemhide']);
    expect(parse('@@||a.com^$ghide').cosmeticOptions).toEqual(['generichide']);
    expect(parse('@@||a.com^$shide').cosmeticOptions).toEqual(['specifichide']);
    expect(parse('@@||a.com^$ehide').cosmeticOptions).toEqual(['elemhide']);
  });

  it('noop options are accepted', () => {
    expect(parse('||a.com^$script,_').resourceTypes).toEqual(['script']);
  });
});

describe('rejections', () => {
  const cases: [string, string][] = [
    ['||a.com^$popup', 'unsupported option "popup"'],
    ['||a.com^$popunder', 'unsupported option "popunder"'],
    ['||a.com^$inline-script', 'unsupported option "inline-script"'],
    ['||a.com^$strict3p', 'unsupported option "strict3p"'],
    ['||a.com^$replace=/a/b/', 'unsupported option "replace"'],
    ['||a.com^$webrtc', 'unsupported option "webrtc"'],
    ['||a.com^$genericblock', 'unsupported option "genericblock"'],
    ['||a.com^$notreal', 'unknown option "notreal"'],
    ['||a.com^$method=teleport', 'unsupported $method "teleport"'],
    ['||a.com^$domain=/only-regex/', '$domain has no usable entries'],
  ];
  for (const [raw, expected] of cases) {
    it(`${raw} → ${expected}`, () => {
      expect(reason(raw)).toBe(expected);
    });
  }

  it('rejects empty lines', () => {
    expect(reason('   ')).toBe('empty line');
  });
});

describe('AdGuard-only syntax is dropped with a reason', () => {
  const reason = (raw: string): string => {
    const result = parseNetworkFilter(raw, 1);
    return result.ok ? '' : result.reason;
  };

  it('names AdGuard HTML filtering ($$) instead of guessing an option', () => {
    expect(reason('animex.club$$script[tag-content="x"][max-length="20000"]')).toBe(
      'AdGuard HTML filtering ("$$") is unsupported on MV3',
    );
    expect(reason('adshrink.it$$script:contains(displayMessage:)')).toBe(
      'AdGuard HTML filtering ("$$") is unsupported on MV3',
    );
    expect(reason('/javascript.js^$$script,subdocument,third-party')).toBe(
      'AdGuard HTML filtering ("$$") is unsupported on MV3',
    );
  });

  it('names AdGuard-only options', () => {
    expect(reason('||example.com^$stealth')).toBe('AdGuard-only option "stealth" has no MV3 equivalent');
    expect(reason('||example.com^$cookie=/.+/')).toBe('AdGuard-only option "cookie" has no MV3 equivalent');
    expect(reason('||example.com^$app=org.example')).toBe('AdGuard-only option "app" has no MV3 equivalent');
    expect(reason('||example.com^$jsinject')).toBe('AdGuard-only option "jsinject" has no MV3 equivalent');
  });

  it('still reports a genuinely unknown option as unknown', () => {
    expect(reason('||example.com^$definitelynotanoption')).toBe('unknown option "definitelynotanoption"');
  });
});

describe('urlhaus-style $all filters', () => {
  it('keeps every resource type and anchors on the hostname', () => {
    const result = parseNetworkFilter('||malware.example^$all', 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.isAll).toBe(true);
    expect(result.filter.hostname).toBe('malware.example');
    expect(result.filter.hostRest).toBe('^');
    expect(result.filter.resourceTypes).toContain('main_frame');
    expect(result.filter.resourceTypes).toContain('script');
  });
});

describe('ABP abp-resource redirects', () => {
  it('resolves the blank-* spellings', () => {
    for (const name of ['blank-js', 'blank-mp3', 'blank-gif', 'blank-text']) {
      const result = parseNetworkFilter(`||example.com^$rewrite=abp-resource:${name}`, 1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.filter.redirect).toBe(name);
    }
  });
});

describe('||* patterns (DNR rejects a urlFilter starting with "||*")', () => {
  const filterOf = (raw: string) => {
    const result = parseNetworkFilter(raw, 1);
    return result.ok ? result.filter : null;
  };

  it('drops the domain anchor and keeps the remainder as a substring', () => {
    expect(filterOf('||*.libaishuo.com^$third-party')?.pattern).toBe('.libaishuo.com^');
    expect(filterOf('||*-aaa.net^')?.pattern).toBe('-aaa.net^');
    expect(filterOf('||*.servimg.com/u/f45/')?.pattern).toBe('.servimg.com/u/f45/');
    expect(filterOf('||*/ad/')?.pattern).toBe('/ad/');
  });

  it('keeps them as plain text patterns, never host-anchored', () => {
    const f = filterOf('||*.libaishuo.com^');
    expect(f?.kind).toBe('text');
    expect(f?.hostname).toBeUndefined();
  });

  it('drops a pattern that is nothing but "||*"', () => {
    const result = parseNetworkFilter('||*', 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('pattern "||*" matches everything');
  });

  it('leaves a normal host anchor alone', () => {
    const f = filterOf('||example.com^');
    expect(f?.kind).toBe('hostAnchor');
    expect(f?.hostname).toBe('example.com');
  });
});
