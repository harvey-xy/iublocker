import fs from 'node:fs';
const files = fs.readdirSync('.cache/lists').filter((f) => f.endsWith('.txt'));
let nonAsciiCosmetic = 0, examples = [];
let regexDollar3p = 0, rex = [];
let lastDollar = 0, lex = [];
const optStart = /[A-Za-z~_]/;
for (const f of files) {
  const text = fs.readFileSync('.cache/lists/' + f, 'utf8');
  for (const line0 of text.split('\n')) {
    const line = line0.trim();
    if (line === '' || line.startsWith('!') || line.startsWith('[')) continue;
    // cosmetic with non-ascii domain
    const m = /^([^#]*)#(@?)(\$?)(\??)#/.exec(line);
    if (m && m[1] !== '' && /[^\x00-\x7f]/.test(m[1])) {
      nonAsciiCosmetic++;
      if (examples.length < 12) examples.push(f + ' | ' + line.slice(0, 90));
      continue;
    }
    if (m) continue;
    // network: regex pattern followed by $3p / $1p
    if (line.startsWith('/') || line.startsWith('@@/')) {
      const body = line.startsWith('@@') ? line.slice(2) : line;
      if (/\/\$[0-9]/.test(body)) { regexDollar3p++; if (rex.length < 10) rex.push(f + ' | ' + line.slice(0, 110)); }
    }
    // network: first $ vs last $
    const body = line.startsWith('@@') ? line.slice(2) : line;
    if (!body.startsWith('/')) {
      const first = body.indexOf('$');
      if (first > 0) {
        const later = body.indexOf('$', first + 1);
        if (later !== -1) {
          // our parser picks `first`; uBO picks the last one introducing options
          lastDollar++;
          if (lex.length < 14) lex.push(f + ' | ' + line.slice(0, 110));
        }
      }
    }
  }
}
console.log('cosmetic filters with non-ASCII domain list:', nonAsciiCosmetic);
examples.forEach((e) => console.log('   ', e));
console.log('regex pattern + $<digit> options:', regexDollar3p);
rex.forEach((e) => console.log('   ', e));
console.log('non-regex lines with more than one $:', lastDollar);
lex.forEach((e) => console.log('   ', e));
