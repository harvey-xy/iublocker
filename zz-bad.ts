import { readFileSync, readdirSync } from 'node:fs';
import { classifyLines } from './packages/compiler/src/parser/classify';
import { badfilterKey, parseNetworkFilter } from './packages/compiler/src/parser/network-filter';

const files = readdirSync('.cache/lists').filter((f) => f.endsWith('.txt'));
const allKeys = new Set<string>();
const bads: { raw: string; key: string; file: string }[] = [];
for (const f of files) {
  const c = classifyLines(readFileSync('.cache/lists/' + f, 'utf8'), {
    format: f.startsWith('peter-lowe') ? 'hosts' : undefined,
  });
  for (const line of c.network) {
    const r = parseNetworkFilter(line.raw, line.line);
    if (!r.ok) continue;
    if (r.filter.badfilter) bads.push({ raw: line.raw, key: badfilterKey(r.filter), file: f });
    else allKeys.add(badfilterKey(r.filter));
  }
}
const unmatched = bads.filter((b) => !allKeys.has(b.key));
console.log('badfilter lines parsed:', bads.length, 'unmatched:', unmatched.length);
for (const b of unmatched.slice(0, 30)) console.log('  ', b.file, '|', b.raw.slice(0, 120));
