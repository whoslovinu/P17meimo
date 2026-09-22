// scripts/d1r1c-deploy-82.mjs — Deploy #82 (admin/users/page.tsx only)
// Steps: snapshot -> health check -> upload -> tsc -> build -> reload -> verify
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client as SshClient } from 'ssh2';
import https from 'node:https';

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USERNAME = 'ubuntu';
const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');

const REMOTE_APP = '/var/www/app';
const LOCAL_FILE = path.resolve('app/admin/users/page.tsx');
const REMOTE_FILE = `${REMOTE_APP}/app/admin/users/page.tsx`;

const APPROVED_HASH = 'ECB7F5D08840A2297F616DAA01F89F46A45C8885AEA96697EEA22606D4F74F10';
const APPROVED_77_HASH = 'B095F020758C7BCCE32FE84B5F912C03069894BF8EFCE238C6009F0B4B56B624';
const D1R1_HASHES = {
  'lib/db/pg.ts': '60A1D273BE9A58DE18A09573E46B8D5ADC0603BE2E70087C6A44CABD41C538E9',
  'app/api/action/attack/route.ts': '18AEFCB6DD551B5D331A3DAE9ACF1816ED4A203C40E588487FADFFEF5F60BE77',
  'app/api/admin/users/search/route.ts': '3459C3E2D10235F15CB8E666880AD8A191B8418E4B18CAF884A0A9F52CB9F3E1',
};

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${label}] ${msg}`);
}

function sha256Local(filePath) {
  const crypto = require('node:crypto');
  const content = require('node:fs').readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex').toUpperCase();
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function sshExec(client, cmd) {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err) { reject(err); return; }
      let out = '', err2 = '';
      stream.on('data', d => out += d);
      stream.stderr.on('data', d => err2 += d);
      stream.on('close', () => resolve({ out, err: err2 }));
    });
  });
}

async function main() {
  const privateKey = await readFile(KEY_PATH, 'utf8');
  const client = new SshClient();

  await new Promise((resolve, reject) => {
    client.on('ready', resolve);
    client.on('error', reject);
    client.connect({
      host: BASTION_HOST,
      port: BASTION_PORT,
      username: BASTION_USERNAME,
      privateKey,
      readyTimeout: 30000,
    });
  });
  log('SSH', 'Connected');

  // --- STEP 2: Pre-deploy snapshot ---
  const UTC_NOW = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
  const SNAPSHOT_DIR = `${REMOTE_APP}/.rollback/customer-feedback-82-before-${UTC_NOW}`;

  log('SNAPSHOT', `Creating rollback dir: ${SNAPSHOT_DIR}`);
  await sshExec(client, `mkdir -p "${SNAPSHOT_DIR}"`);

  log('SNAPSHOT', 'Backing up admin/users/page.tsx...');
  await sshExec(client, `cp "${REMOTE_FILE}" "${SNAPSHOT_DIR}/page.tsx"`);
  log('SNAPSHOT', 'Backed up.');

  // Record pre-deploy state
  log('STATE', 'Fetching pre-deploy BUILD_ID...');
  const buildIdResult = await sshExec(client, `cat "${REMOTE_APP}/.next/BUILD_ID" 2>/dev/null`);
  const PRE_BUILD_ID = buildIdResult.out.trim();

  log('STATE', 'Fetching pre-deploy PM2 status...');
  const pm2Result = await sshExec(client, `pm2 jlist | python3 -c "import sys,json; rows=json.load(sys.stdin); rows2=[r for r in rows if r['name']=='repark-h5']; print(json.dumps(rows2, indent=2))" 2>/dev/null || pm2 jlist 2>/dev/null | head -50`);
  const PRE_PID = pm2Result.out.match(/"pid":\s*(\d+)/) ? pm2Result.out.match(/"pid":\s*(\d+)/)[1] : 'unknown';

  log('STATE', `Pre-deploy BUILD_ID: ${PRE_BUILD_ID}`);
  log('STATE', `Pre-deploy PM2 PID: ${PRE_PID}`);

  // Record pre-deploy source hash
  log('STATE', 'Computing pre-deploy source hash...');
  const preHashResult = await sshExec(client, `sha256sum "${REMOTE_FILE}" 2>/dev/null || shasum -a 256 "${REMOTE_FILE}" 2>/dev/null || python3 -c "import hashlib; print(hashlib.sha256(open('${REMOTE_FILE}','rb').read()).hexdigest())"`);
  const PRE_SOURCE_HASH = preHashResult.out.trim().split(' ')[0].toUpperCase();
  log('STATE', `Pre-deploy source hash: ${PRE_SOURCE_HASH}`);

  // --- STEP 3: Health check ---
  log('HEALTH', 'Checking /api/time...');
  try {
    const resp = await httpGet('https://98.93.252.250/api/time');
    log('HEALTH', `/api/time: HTTP ${resp.status}`);
  } catch (e) {
    log('HEALTH', `/api/time FAILED: ${e.message}`);
  }

  // --- STEP 4: Upload approved file ---
  log('UPLOAD', 'Uploading approved page.tsx...');
  await new Promise((resolve, reject) => {
    client.sftp(async (err, sftp) => {
      if (err) { console.error('SFTP err:', err.message); process.exit(1); }
      const content = await readFile(LOCAL_FILE, 'utf8');
      log('SFTP', `Uploading ${content.length} bytes...`);
      await new Promise((res2, rej2) => {
        const ws = sftp.createWriteStream(REMOTE_FILE, { mode: 0o644 });
        ws.on('close', res2);
        ws.on('error', rej2);
        ws.end(content);
      });
      log('SFTP', 'Upload complete');
      resolve();
    });
  });

  // Verify uploaded hash
  log('VERIFY', 'Computing remote hash after upload...');
  const postHashResult = await sshExec(client, `sha256sum "${REMOTE_FILE}" 2>/dev/null || shasum -a 256 "${REMOTE_FILE}" 2>/dev/null || python3 -c "import hashlib; print(hashlib.sha256(open('${REMOTE_FILE}','rb').read()).hexdigest())"`);
  const POST_SOURCE_HASH = postHashResult.out.trim().split(' ')[0].toUpperCase();
  log('VERIFY', `Post-upload source hash: ${POST_SOURCE_HASH}`);
  if (POST_SOURCE_HASH !== APPROVED_HASH) {
    log('ERROR', `HASH MISMATCH! Expected ${APPROVED_HASH}, got ${POST_SOURCE_HASH}`);
    log('ERROR', 'Restoring snapshot...');
    await sshExec(client, `cp "${SNAPSHOT_DIR}/page.tsx" "${REMOTE_FILE}"`);
    client.end();
    process.exit(4);
  }
  log('VERIFY', 'Source hash MATCHES approved.');

  // --- STEP 5: Server tsc ---
  log('TSC', 'Running tsc --noEmit on server...');
  const tscResult = await sshExec(client, `cd "${REMOTE_APP}" && npx tsc --noEmit 2>&1 | tail -20`);
  log('TSC', `Exit: ${tscResult.out.includes('error') ? 'FAIL' : 'PASS'}`);
  if (tscResult.out.includes('error')) {
    log('TSC', tscResult.out.slice(0, 500));
    log('ERROR', 'TSC failed. Restoring snapshot...');
    await sshExec(client, `cp "${SNAPSHOT_DIR}/page.tsx" "${REMOTE_FILE}"`);
    client.end();
    process.exit(5);
  }

  // --- STEP 6: Server build ---
  log('BUILD', 'Running production build...');
  const buildResult = await sshExec(client, `cd "${REMOTE_APP}" && sudo npm run build 2>&1 | tail -30`);
  log('BUILD', buildResult.out.slice(-200));

  const POST_BUILD_ID = 'check logs';

  // --- STEP 7: PM2 reload ---
  log('PM2', 'Reloading pm2...');
  const reloadResult = await sshExec(client, `pm2 reload repark-h5 --update-env 2>&1`);
  log('PM2', reloadResult.out.slice(0, 300));

  // Wait for restart
  await new Promise(r => setTimeout(r, 8000));

  // Verify PM2
  const pm2After = await sshExec(client, `pm2 jlist 2>/dev/null | python3 -c "import sys,json; rows=json.load(sys.stdin); rows2=[r for r in rows if r['name']=='repark-h5']; print(json.dumps(rows2[0] if rows2 else {}, indent=2))" 2>/dev/null`);
  const AFTER_PID = pm2After.out.match(/"pid":\s*(\d+)/) ? pm2After.out.match(/"pid":\s*(\d+)/)[1] : 'unknown';
  log('PM2', `After reload PID: ${AFTER_PID}`);

  // Health after
  log('HEALTH', 'Checking /api/time after reload...');
  try {
    const resp = await httpGet('https://98.93.252.250/api/time');
    log('HEALTH', `/api/time: HTTP ${resp.status}`);
  } catch (e) {
    log('HEALTH', `/api/time FAILED: ${e.message}`);
  }

  // --- STEP 8: Verify deployed source hash ---
  const finalHashResult = await sshExec(client, `sha256sum "${REMOTE_FILE}" 2>/dev/null || python3 -c "import hashlib; print(hashlib.sha256(open('${REMOTE_FILE}','rb').read()).hexdigest())"`);
  const FINAL_HASH = finalHashResult.out.trim().split(' ')[0].toUpperCase();

  // --- STEP 8b: Verify #77 file unchanged ---
  log('VERIFY', 'Checking #77 (activities/page.tsx) hash...');
  const hash77Result = await sshExec(client, `sha256sum "${REMOTE_APP}/app/admin/activities/page.tsx" 2>/dev/null || python3 -c "import hashlib; print(hashlib.sha256(open('${REMOTE_APP}/app/admin/activities/page.tsx','rb').read()).hexdigest())"`);
  const HASH_77 = hash77Result.out.trim().split(' ')[0].toUpperCase();

  // --- STEP 8c: D1-R1 hashes ---
  const d1r1Results = {};
  for (const [file, expectedHash] of Object.entries(D1R1_HASHES)) {
    const remotePath = `${REMOTE_APP}/${file}`;
    const r = await sshExec(client, `sha256sum "${remotePath}" 2>/dev/null || python3 -c "import hashlib; print(hashlib.sha256(open('${remotePath}','rb').read()).hexdigest())"`);
    const h = r.out.trim().split(' ')[0].toUpperCase();
    d1r1Results[file] = { expected: expectedHash, actual: h, match: h === expectedHash };
    log('VERIFY', `${file}: ${h === expectedHash ? 'MATCH' : 'DRIFT'}`);
  }

  // --- STEP 11: Compiled bundle check ---
  log('BUNDLE', 'Checking compiled bundle for fuzzy-search copy...');
  const bundleFiles = await sshExec(client, `ls "${REMOTE_APP}/.next/static/chunks/app/admin/users/" 2>/dev/null | head -5`);
  log('BUNDLE', `Chunk files: ${bundleFiles.out.trim()}`);

  // Check for 模糊筛选 in chunks
  const chunkCheck = await sshExec(client, `grep -l "模糊筛选" "${REMOTE_APP}/.next/static/chunks/app/admin/users/"* 2>/dev/null || echo "NOT_FOUND_IN_STATIC"`);
  log('BUNDLE', `模糊筛选 in static chunks: ${chunkCheck.out.trim()}`);

  // Also check server chunks
  const serverChunkCheck = await sshExec(client, `grep -l "模糊筛选" "${REMOTE_APP}/.next/server/chunks/"* 2>/dev/null || echo "NOT_FOUND_IN_SERVER"`);
  log('BUNDLE', `模糊筛选 in server chunks: ${serverChunkCheck.out.trim()}`);

  // --- STEP 12: Error log check ---
  log('LOGS', 'Checking recent logs for new errors...');
  const logCheck = await sshExec(client, `tail -50 /home/ubuntu/.pm2/logs/repark-h5-out.log 2>/dev/null | grep -E "error|Error|ERROR|failed|Failed|FAILED" | tail -10 || echo "no errors found"`);
  log('LOGS', logCheck.out.trim() || 'No new errors detected');

  // Final summary
  console.log('\n========================================');
  console.log('CUSTOMER FEEDBACK #82 — PRODUCTION ACCEPTANCE');
  console.log('========================================');
  console.log(`SNAPSHOT_DIR: ${SNAPSHOT_DIR}`);
  console.log(`PRE_BUILD_ID: ${PRE_BUILD_ID}`);
  console.log(`PRE_PM2_PID: ${PRE_PID}`);
  console.log(`PRE_SOURCE_HASH: ${PRE_SOURCE_HASH}`);
  console.log(`POST_SOURCE_HASH: ${FINAL_HASH}`);
  console.log(`APPROVED_HASH MATCH: ${FINAL_HASH === APPROVED_HASH ? 'YES' : 'NO'}`);
  console.log(`AFTER_PM2_PID: ${AFTER_PID}`);
  console.log(`#77 INTEGRITY: ${HASH_77 === APPROVED_77_HASH ? 'MATCH' : 'DRIFT'}`);
  console.log(`D1-R1 INTEGRITY: ${Object.values(d1r1Results).every(r => r.match) ? 'MATCH' : 'DRIFT'}`);
  console.log(`模糊筛选 IN BUNDLE: ${chunkCheck.out.includes('模糊筛选') || serverChunkCheck.out.includes('模糊筛选') ? 'FOUND' : 'NOT FOUND'}`);
  console.log('========================================');

  client.end();
  process.exit(0);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(9); });
