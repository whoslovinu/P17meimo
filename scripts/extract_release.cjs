// scripts/extract_release.cjs
// Extract files from a git commit preserving LF line endings (no BOM, no CRLF)
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const COMMIT = '67cd80e064056e324a0b49f694876ee7f5294381';
const FILES = [
  ['app/api/action/attack/route.ts', 'route.ts'],
  ['lib/auth.ts',                     'auth.ts'],
  ['lib/userIdentity.ts',             'userIdentity.ts'],
  ['lib/db/postgres.ts',              'postgres.ts'],
  ['lib/db/pg.ts',                    'pg.ts'],
  ['lib/battleRedis.ts',              'battleRedis.ts'],
];

const OUT_DIR = '.tmp_release';
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const EXPECTED = {
  'route.ts':        '74f4e2bc7243b24ad193ca9cd13db0cb4a98748be81e55603cfd6a46cbfafa5f',
  'auth.ts':         '17183aa4af0aa6c616bf538ecda1ee2d088023f42d50588a4fa93d9ffb5e6c54',
  'userIdentity.ts': '96e00e5f0eba0ad75861b6422a6536d617c29eb166978a96d1896d59f0e3e86b',
  'postgres.ts':     'c54b4a72368474633da6e99f0cdd0061ca22e885ed86283c2f5639e7eb16a25d',
  'pg.ts':           'c85606a4a06400fbf675e52ba787d458e3aec8b7b08ce14134b5f6ef416aba29',
  'battleRedis.ts':  '40754e4d62583c667d5669d07d442d37d02c89555b3ada708df79a28c15d0fbb',
};

const crypto = require('node:crypto');

for (const [rel, out] of FILES) {
  const buf = execSync(`git cat-file -p ${COMMIT}:${rel}`, { encoding: 'buffer' });
  fs.writeFileSync(path.join(OUT_DIR, out), buf);
  const h = crypto.createHash('sha256').update(buf).digest('hex');
  const ok = h === EXPECTED[out];
  console.log(`${ok ? 'MATCH' : 'MISMATCH'}  ${out}  size=${buf.length}  sha256=${h}`);
  if (!ok) {
    console.log(`        expected=${EXPECTED[out]}`);
  }
}