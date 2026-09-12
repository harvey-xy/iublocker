import { describe, expect, it } from 'vitest';
import { compileNetwork } from '../src/network';
import { classifyLines } from '../src/parser/classify';

function rules(...lines: string[]) {
  return compileNetwork(
    lines.map((raw, i) => ({ line: i + 1, raw })),
    { listId: 't', trusted: true },
  );
}

describe('probe', () => {
  it('header', () => {
    console.log(JSON.stringify(rules('||a.com^$header=content-type:text/html').rules, null, 1));
    console.log(JSON.stringify(rules('||a.com^$header=via:/^1\\.1 google/').rules, null, 1));
    console.log(JSON.stringify(rules('||a.com^$~header=x-foo').rules, null, 1));
  });
  it('matchcase regex', () => {
    console.log(JSON.stringify(rules('/Ads/$match-case').rules, null, 1));
    console.log(JSON.stringify(rules('/ads/$script').rules, null, 1));
  });
  it('host anchor no sep', () => {
    console.log(JSON.stringify(rules('||example.com').rules, null, 1));
    console.log(JSON.stringify(rules('||example.com^').rules, null, 1));
    console.log(JSON.stringify(rules('||example.com/').rules, null, 1));
    console.log(JSON.stringify(rules('||example.com:8080^').rules, null, 1));
    console.log(JSON.stringify(rules('||example.com^*/ads').rules, null, 1));
  });
  it('uppercase', () => {
    console.log(JSON.stringify(rules('||Example.COM/Ads.JS').rules, null, 1));
    console.log(JSON.stringify(rules('/AdServer/$image').rules, null, 1));
  });
  it('idn', () => {
    console.log(JSON.stringify(rules('||пример.рф^').rules, null, 1));
    console.log(JSON.stringify(rules('||example.com/путь').rules, null, 1), rules('||example.com/путь').dropped);
  });
  it('denyallow/to', () => {
    console.log(JSON.stringify(rules('*$script,domain=a.com,denyallow=b.com|c.com').rules, null, 1));
    console.log(JSON.stringify(rules('/ads$to=a.com|~b.a.com').rules, null, 1));
  });
  it('removeparam', () => {
    console.log(JSON.stringify(rules('$removeparam=utm_source').rules, null, 1));
    console.log(JSON.stringify(rules('||a.com^$removeparam=/^utm_/').rules, null, 1), rules('||a.com^$removeparam=/^utm_/').dropped);
  });
  it('csp', () => {
    console.log(JSON.stringify(rules("||site.com^$csp=script-src 'none'").rules, null, 1));
    console.log(JSON.stringify(rules("@@||site.com^$csp").rules, null, 1), rules("@@||site.com^$csp").dropped);
  });
  it('doc allow', () => {
    console.log(JSON.stringify(rules('@@||site.com^$document').rules, null, 1));
    console.log(JSON.stringify(rules('@@||site.com^$elemhide').rules, null, 1), JSON.stringify(rules('@@||site.com^$elemhide').cosmeticExceptions));
    console.log(JSON.stringify(rules('@@||site.com^').rules, null, 1));
    console.log(JSON.stringify(rules('@@').rules, null, 1), rules('@@').dropped);
  });
});
