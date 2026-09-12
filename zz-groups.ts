import { readFileSync, readdirSync } from 'node:fs';
import type { ScriptletDB } from './packages/shared/src/scriptlets';
import { computeScriptletGroups } from './packages/compiler/src/scriptlet/groups';
import { lookupScriptletsDetailed } from './packages/compiler/src/scriptlet/compile';
import { registry } from './packages/scriptlets/src/index';

const dir = 'packages/extension/rulesets/scriptlets';
const dbs = readdirSync(dir).map((f) => ({
  listId: f.replace('.json', ''),
  db: JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as ScriptletDB,
}));
const groups = computeScriptletGroups(dbs);
console.log('groups', groups.length);

const walk = (h: string): string[] => {
  const out: string[] = [];
  let s = h;
  for (;;) {
    out.push(s);
    const d = s.indexOf('.');
    if (d === -1) break;
    s = s.slice(d + 1);
  }
  return out;
};
// simulate the emitted group file for one hostname
function simulate(host: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const g of groups) {
    // registrar: match patterns from g.hosts
    const covered = g.hosts.includes('*') || walk(host).some((s) => g.hosts.includes(s));
    if (!covered) continue;
    const X = new Set(g.exclude);
    let idx = [...g.genericArgs];
    let blocked = false;
    for (const level of walk(host)) {
      if (X.has(level)) { blocked = true; break; }
      const row = g.hostArgs[level];
      if (row !== undefined) idx = idx.concat(row);
    }
    if (blocked) continue;
    for (const i of idx) {
      const args = g.argsList[i];
      if (args === undefined) continue;
      const set = out.get(g.name) ?? new Set<string>();
      set.add(JSON.stringify(args));
      out.set(g.name, set);
    }
  }
  return out;
}

const hosts = new Set<string>();
for (const { db } of dbs) for (const k of Object.keys(db.byHost)) if (k !== '*' && !k.endsWith('.*')) hosts.add(k);
// plus some synthetic subdomains
const list = [...hosts];
for (const h of list.slice(0, 4000)) hosts.add('www.' + h);
let checked = 0, mismatches = 0;
const shown: string[] = [];
const all = dbs.map((d) => d.db);
const canon = (n: string): string => {
  if (registry[n] !== undefined) return n;
  for (const [k, v] of Object.entries(registry)) if (v.aliases.includes(n)) return k;
  return n;
};
for (const host of hosts) {
  checked++;
  const expected = new Map<string, Set<string>>();
  for (const call of lookupScriptletsDetailed(all, host).concrete) {
    const name = canon(call.name);
    if (registry[name] === undefined) continue;
    const set = expected.get(name) ?? new Set<string>();
    set.add(JSON.stringify(call.args));
    expected.set(name, set);
  }
  const got = simulate(host);
  const keys = new Set([...expected.keys(), ...got.keys()]);
  for (const k of keys) {
    const e = [...(expected.get(k) ?? [])].sort().join('|');
    const g = [...(got.get(k) ?? [])].sort().join('|');
    if (e !== g) {
      mismatches++;
      if (shown.length < 15) shown.push(`${host} ${k}\n   expected ${e}\n   got      ${g}`);
    }
  }
}
console.log('hosts checked', checked, 'mismatches', mismatches);
shown.forEach((s) => console.log(s));
