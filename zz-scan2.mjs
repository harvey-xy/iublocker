import fs from 'node:fs';
const files = fs.readdirSync('.cache/lists').filter((f) => f.endsWith('.txt'));
const opt = /^[A-Za-z0-9~_]/;
let n = 0; const ex = [];
for (const f of files) {
  for (const line0 of fs.readFileSync('.cache/lists/' + f, 'utf8').split('\n')) {
    const line = line0.trim();
    if (line === '' || line.startsWith('!') || line.startsWith('[')) continue;
    if (line.includes('#%#') || line.includes('$$') || /#@?\$?\??#/.test(line)) continue;
    const body = line.startsWith('@@') ? line.slice(2) : line;
    if (body.startsWith('/')) continue;
    const dollars = [];
    for (let i = 0; i < body.length; i++) if (body[i] === '$' && body[i - 1] !== '\\') dollars.push(i);
    if (dollars.length < 2) continue;
    n++;
    if (ex.length < 25) ex.push(f + ' | ' + line.slice(0, 120));
  }
}
console.log('candidates', n);
ex.forEach((e) => console.log('  ', e));
