// Quick deployment audit: extract from latest tarball and verify csrf.ts
const { execSync } = require('child_process');
const fs = require('fs');

const workdir = 'H:/tmp/check';
try { fs.rmSync(workdir, { recursive: true, force: true }); } catch {}
fs.mkdirSync(workdir, { recursive: true });

execSync(`tar -xzf H:/tmp/repark-deploy-2026-07-29.tar.gz -C ${workdir} lib/csrf.ts`, { stdio: 'inherit' });

const content = fs.readFileSync(`${workdir}/lib/csrf.ts`, 'utf8');
console.log('hostnameMatches count:', (content.match(/hostnameMatches/g) || []).length);
console.log('hostnameOf count:', (content.match(/hostnameOf/g) || []).length);
console.log('hostMatches count:', (content.match(/hostMatches\(/g) || []).length); // old name
console.log('first 200 chars:', content.substring(0, 200));
