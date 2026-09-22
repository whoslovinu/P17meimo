import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.length < 3 || args.length % 2 !== 1) {
  console.error('usage: node _batch0e_replace.mjs FILE FROM TO [FROM TO ...]');
  process.exit(2);
}
const file = args[0];
const pairs = [];
for (let i = 1; i + 1 < args.length; i += 2) pairs.push([args[i], args[i + 1]]);
if (!existsSync(file)) { console.error('NOT_FOUND: ' + file); process.exit(1); }
let s = readFileSync(file, 'utf8');
let total = 0;
for (const [from, to] of pairs) {
  const n = s.split(from).length - 1;
  if (n === 0) { console.log(file + ': no match for [' + from.slice(0,12) + '...]'); continue; }
  s = s.split(from).join(to);
  total += n;
  console.log(file + ': replaced ' + n + ' occurrence(s) for [' + from.slice(0,12) + '...] -> [' + to + ']');
}
writeFileSync(file, s, 'utf8');
console.log(file + ': total replaced = ' + total);