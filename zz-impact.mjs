import fs from 'node:fs';
const dir = 'packages/extension/rulesets/cosmetic';
const dbs = fs.readdirSync(dir).map((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')));
const badHosts = ['techorange.com','space.com','bilibili.com','wallstreet-online.de','jeuxvideo.com','cdiscount.com','korben.info','nextinpact.com','discordbots.org','santemagazine.fr','sookbtp.com','starbike.com','majorgeeks.com','classcentral.com','tympanus.net','games2rule.com','wp.pl','pudelek.pl','autokult.pl'];
const walk = (h) => { const out=[]; let s=h; for(;;){ out.push(s); const d=s.indexOf('.'); if(d===-1) break; s=s.slice(d+1);} return out; };
let total=0;
for (const host of badHosts) {
  const keys = walk(host);
  const sels = new Set();
  for (const db of dbs) for (const k of keys) for (const s of (db.specific[k] ?? [])) sels.add(s);
  console.log(host.padEnd(24), sels.size, 'selectors in the poisoned chunk');
  total += sels.size;
}
console.log('total specific selectors lost:', total);
