import { describe, expect, it } from 'vitest';
import { compileNetwork } from '../src/network';

function rules(...lines: string[]) {
  return compileNetwork(
    lines.map((raw, i) => ({ line: i + 1, raw })),
    { listId: 't', trusted: true },
  );
}
const j = (x: unknown) => JSON.stringify(x, null, 1);

describe('probe2', () => {
  it('merge keys', () => {
    console.log('A', j(rules('||a.com^', '||b.com^$script').rules));
    console.log('B', j(rules('||a.com^', '||b.com^').rules));
    console.log('C', j(rules('||a.com^', '||b.com^$important').rules));
    console.log('D', j(rules('||a.com^', '@@||b.com^').rules));
    console.log('E', j(rules('||a.com^$domain=x.com', '||b.com^$domain=x.com').rules));
    console.log('F', j(rules('||a.com^$3p', '||b.com^$third-party').rules));
    console.log('G', j(rules('||a.com^$denyallow=z.com,domain=q.com', '||b.com^$denyallow=z.com,domain=q.com').rules));
    console.log('H', j(rules('||a.com^$match-case', '||b.com^').rules));
  });
  it('shadow', () => {
    console.log('S1', j(rules('||a.com^', '||a.com/x$script').rules), rules('||a.com^', '||a.com/x$script').dropped);
    const r2 = rules('||a.com^', '@@||a.com/x$script');
    console.log('S2', j(r2.rules), r2.dropped);
    const r3 = rules('||a.com^', '||a.com/x$script,important');
    console.log('S3', j(r3.rules), r3.dropped);
    const r4 = rules('||a.com^$script', '||a.com/x$script');
    console.log('S4', j(r4.rules), r4.dropped);
    const r5 = rules('||a.com^', '||sub.a.com/x$image,domain=q.com');
    console.log('S5', j(r5.rules), r5.dropped);
    const r6 = rules('||a.com^', '||a.com/x$redirect=noop.js');
    console.log('S6', j(r6.rules), r6.dropped);
    const r7 = rules('||a.com^', '||a.com/x$removeparam=p');
    console.log('S7', j(r7.rules), r7.dropped);
    const r8 = rules('||a.com^', '||a.com/x$document');
    console.log('S8', j(r8.rules), r8.dropped);
    const r9 = rules('||a.com^', '||a.com/x$csp=foo');
    console.log('S9', j(r9.rules), r9.dropped);
  });
  it('redirect-rule gating', () => {
    const r = rules('||a.com/ads.js$script', '||a.com/ads.js$script,redirect-rule=noop.js');
    console.log('RR', j(r.rules), r.dropped);
    const r2 = rules('||a.com^$script', '||a.com/ads.js$script,redirect-rule=noop.js');
    console.log('RR2', j(r2.rules), r2.dropped);
  });
});
