import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
const cases = [
  'a:has(b:has(c))',
  'a:has(b:not(:has(c)))',
  'a:has(:is(b:has(c)))',
  'a:has(b:is(c))',
  'a:not(:has(b))',
  'a:has(b):has(c)',
  'a:is(:has(b))',
  'a:has(> b:has(c))',
  'a:has(b:where(:has(c)))',
  'a:not(b:has(c))',
  'a:is(b:has(c))',
  'a:where(b:has(c))',
  'a:has(b:not(c))',
  'a:has(b:nth-child(2n+1 of .x))',
  '.a:nth-child(2n+1 of .x)',
  '[href="x" i]',
  '.a:has(.b) .c:has(.d)',
  'a:has(b):not(:has(c))',
  ':has(a)',
  'a::before:has(b)',
  'a:has(b::before)',
  'a:has(+ b)',
  'a:has(~ b:has(c))',
];
const res = await page.evaluate((list) => list.map((s) => {
  let qs = true, css = true;
  try { document.querySelector(s); } catch { qs = false; }
  try { const sh = new CSSStyleSheet(); sh.replaceSync(s + '{color:red}'); css = sh.cssRules.length > 0; } catch { css = false; }
  return [s, qs, css];
}), cases);
for (const r of res) console.log(r[1] && r[2] ? 'OK   ' : 'BAD  ', r[0], r[1], r[2]);
await browser.close();
