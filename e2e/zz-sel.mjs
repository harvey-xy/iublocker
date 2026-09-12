import fs from 'node:fs';
import { chromium } from '@playwright/test';

const dir = '../packages/extension/rulesets/cosmetic';
const items = [];
for (const f of fs.readdirSync(dir)) {
  const db = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  for (const list of Object.values(db.generic.byId)) for (const s of list) items.push([s, f + ' byId']);
  for (const list of Object.values(db.generic.byClass)) for (const s of list) items.push([s, f + ' byClass']);
  for (const s of db.generic.complex) items.push([s, f + ' complex']);
  for (const [h, list] of Object.entries(db.specific)) for (const s of list) items.push([s, f + ' specific ' + h]);
  for (const [h, list] of Object.entries(db.styles)) for (const p of list) items.push([p[0], f + ' styles ' + h]);
}
const uniq = new Map();
for (const [s, w] of items) if (!uniq.has(s)) uniq.set(s, w);
console.log('distinct selectors', uniq.size, 'of', items.length);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
const sels = [...uniq.keys()];
const bad = [];
const CHUNK = 5000;
for (let i = 0; i < sels.length; i += CHUNK) {
  const part = sels.slice(i, i + CHUNK);
  const res = await page.evaluate((list) => {
    const out = [];
    const sheet = new CSSStyleSheet();
    for (const s of list) {
      let qs = true, css = true;
      try { document.querySelector(s); } catch { qs = false; }
      try {
        sheet.replaceSync(s + '{display:none!important}');
        if (sheet.cssRules.length === 0) css = false;
      } catch { css = false; }
      if (!qs || !css) out.push([s, qs, css]);
    }
    return out;
  }, part);
  bad.push(...res);
}
console.log('invalid', bad.length);
for (const b of bad.slice(0, 120)) console.log(JSON.stringify(b[0]), 'qs=' + b[1], 'css=' + b[2], '||', uniq.get(b[0]));
await browser.close();
