import fs from 'node:fs';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>');
const doc = dom.window.document;
const dir = 'packages/extension/rulesets/cosmetic';
const bad = new Map();
let n = 0;
const test = (sel, where) => {
  n++;
  try { doc.querySelector(sel); } catch (e) {
    if (!bad.has(sel)) bad.set(sel, where);
  }
};
for (const f of fs.readdirSync(dir)) {
  const db = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  for (const list of Object.values(db.generic.byId)) for (const s of list) test(s, f + ' byId');
  for (const list of Object.values(db.generic.byClass)) for (const s of list) test(s, f + ' byClass');
  for (const s of db.generic.complex) test(s, f + ' complex');
  for (const [h, list] of Object.entries(db.specific)) for (const s of list) test(s, f + ' specific ' + h);
  for (const [h, list] of Object.entries(db.styles)) for (const p of list) test(p[0], f + ' styles ' + h);
}
console.log('tested', n, 'distinct-invalid', bad.size);
let i = 0;
for (const [s, w] of bad) { if (i++ < 80) console.log(JSON.stringify(s), '||', w); }
