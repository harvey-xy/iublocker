import { compileNetwork } from '/home/user/iublocker/packages/compiler/src/network/index.ts';
import { classifyLines } from '/home/user/iublocker/packages/compiler/src/parser/classify.ts';

const table = { 'noop.js': 'noop.js', empty: 'empty', 'noop-1s.mp4': 'noop-1s.mp4' };
const lines = `||ads.example.com^
||example.com/banner/*$image,3p
@@||cdn.example.com^$script,domain=site.com
||tracker.com^$important
||example.com/ads.js$redirect=noop.js
$removeparam=utm_source
||site.com^$csp=script-src 'none'
/^https?:\\/\\/[a-z]+\\.ad\\.example\\.com\\//
||example.com^$popup
@@||good.com^$document
||a.com^$removeheader=refresh
||b.com^$header=content-type:text/html
||c.com^$method=get|~post
||d.com^$domain=foo.*
0.0.0.0 hosts.example.org
||e.com^$badfilter
||e.com^
@@||x.com^$elemhide
`;
const c = classifyLines(lines);
const r = compileNetwork(c.network, { listId: 'test', trusted: false, redirectResources: table });
console.log(JSON.stringify(r.rules, null, 1));
console.log('dropped', r.dropped);
console.log('warnings', r.warnings);
console.log('cosmeticExceptions', r.cosmeticExceptions);
console.log('counts', r.counts);
