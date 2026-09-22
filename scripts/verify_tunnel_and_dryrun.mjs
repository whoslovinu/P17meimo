import { createServer } from 'node:net';
import { readFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Client as SshClient } from 'ssh2';
import pg from 'pg';

const { Client } = pg;

// ─── Inline copies from dev_tunnel.mjs (no cross-file import for ESM stability) ───

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USERNAME = 'ubuntu';

const RDS_HOST = 'rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com';
const RDS_PORT = 5432;
const LOCAL_RDS_PORT = 5433;

const LOCAL_FORWARD_HOST = '127.0.0.1';
const KEY_COMMENT = 'mercenary_h5_project';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const defaultKeyDirectory = path.join(projectRoot, 'keys');

// ─── DB credentials ───────────────────────────────────────────────────────────

const DB_USER = 'postgres';
const DB_PASSWORD = process.env.PGPASSWORD || process.env.DATABASE_URL_PASSWORD || 'YOUR_DATABASE_PASSWORD';
const DB_NAME = 'postgres';

// ─── Logging helpers ──────────────────────────────────────────────────────────

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${label}] ${msg}`);
}

function separator(label) {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`  ${label}`);
  console.log('='.repeat(72));
}

// ─── SSH helpers (mirrors dev_tunnel.mjs) ─────────────────────────────────────

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getCandidateKeyPaths() {
  const envPath = process.env.DEPLOY_SSH_KEY_PATH ? process.env.DEPLOY_SSH_KEY_PATH.trim() : '';
  const homeDirectory = os.homedir();

  const candidates = [
    envPath,
    path.join(defaultKeyDirectory, KEY_COMMENT),
    path.join(defaultKeyDirectory, `${KEY_COMMENT}.pem`),
    path.join(projectRoot, '.ssh', KEY_COMMENT),
    path.join(projectRoot, '.ssh', `${KEY_COMMENT}.pem`),
    path.join(homeDirectory, '.ssh', KEY_COMMENT),
    path.join(homeDirectory, '.ssh', `${KEY_COMMENT}.pem`),
    path.join(homeDirectory, '.ssh', 'id_ed25519'),
    path.join(homeDirectory, '.ssh', 'id_rsa'),
  ].filter(Boolean);

  return [...new Set(candidates)];
}

async function resolvePrivateKeyPath() {
  for (const candidatePath of getCandidateKeyPaths()) {
    if (await fileExists(candidatePath)) return candidatePath;
  }
  throw new Error(
    `SSH private key not found for ${KEY_COMMENT}. Set DEPLOY_SSH_KEY_PATH or place key at:\n` +
    getCandidateKeyPaths().map((p) => `  - ${p}`).join('\n'),
  );
}

function buildTunnelServer(remoteHost, remotePort, localPort) {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      sshClient.forwardOut(
        socket.remoteAddress || LOCAL_FORWARD_HOST,
        socket.remotePort || 0,
        remoteHost,
        remotePort,
        (error, stream) => {
          if (error) { socket.destroy(error); return; }
          socket.pipe(stream);
          stream.pipe(socket);
        },
      );
    });
    server.on('error', reject);
    server.listen(localPort, LOCAL_FORWARD_HOST, () => resolve(server));
  });
}

// ─── Main verification ────────────────────────────────────────────────────────

let sshClient = null;
let tunnelServer = null;
let pgClient = null;
let exitCode = 1; // FAIL until proven PASS

async function shutdown() {
  log('CLEANUP', 'Closing resources...');
  const promises = [];
  if (pgClient) promises.push(pgClient.end().catch(() => {}));
  if (tunnelServer) promises.push(new Promise((r) => tunnelServer.close(r)));
  if (sshClient) promises.push(new Promise((r) => { sshClient.end(); r(); }));
  await Promise.allSettled(promises);
}

process.on('SIGINT', async () => {
  console.log('\n[INTERRUPTED]');
  await shutdown();
  process.exit(1);
});

async function run() {
  separator('STEP 1 — SSH Key Resolution');
  let privateKeyPath;
  try {
    privateKeyPath = await resolvePrivateKeyPath();
    log('OK', `Found key: ${privateKeyPath}`);
  } catch (err) {
    log('FAIL', `SSH key resolution failed: ${err.message}`);
    return;
  }

  separator('STEP 2 — SSH Connection to Bastion');
  const privateKey = await readFile(privateKeyPath, 'utf8');
  const passphrase = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;

  try {
    sshClient = await new Promise((resolve, reject) => {
      const client = new SshClient();
      client.on('ready', () => { log('OK', `SSH connected to ${BASTION_HOST}:${BASTION_PORT}`); resolve(client); });
      client.on('error', (err) => { reject(err); });
      client.connect({ host: BASTION_HOST, port: BASTION_PORT, username: BASTION_USERNAME, privateKey, passphrase, readyTimeout: 20000 });
    });
  } catch (err) {
    log('FAIL', `SSH connection failed: [${err.code ?? 'UNKNOWN'}] ${err.message}`);
    return;
  }

  separator('STEP 3 — Tunnel Setup (localhost:5433 -> RDS)');
  try {
    tunnelServer = await buildTunnelServer(RDS_HOST, RDS_PORT, LOCAL_RDS_PORT);
    log('OK', `Tunnel active: ${LOCAL_FORWARD_HOST}:${LOCAL_RDS_PORT} -> ${RDS_HOST}:${RDS_PORT}`);
  } catch (err) {
    log('FAIL', `Tunnel setup failed: ${err.message}`);
    await sshClient.end();
    return;
  }

  separator('STEP 4 — PostgreSQL Connection (via tunnel + SSL)');
  try {
    pgClient = new pg.Client({
      host: LOCAL_FORWARD_HOST,
      port: LOCAL_RDS_PORT,
      database: DB_NAME,
      user: DB_USER,
      password: DB_PASSWORD,
      ssl: { rejectUnauthorized: false },
    });
    await pgClient.connect();
    log('OK', `PG connected to ${DB_NAME}@${LOCAL_FORWARD_HOST}:${LOCAL_RDS_PORT}`);
  } catch (err) {
    log('FAIL', `PostgreSQL connection failed: [${err.code ?? 'UNKNOWN'}] ${err.message}`);
    await tunnelServer.close();
    await sshClient.end();
    return;
  }

  separator('STEP 5 — Query Active Activity for Milestone Config');
  let activityId;
  let milestones;

  try {
    const result = await pgClient.query(
      `SELECT id, config->'milestones' as milestones
       FROM public.activities
       WHERE config->>'isGlobalEnabled' = 'true'
       LIMIT 1;`,
    );

    if (result.rows.length === 0) {
      log('WARN', 'No enabled activity found — using test payload (no state will be changed)');
      activityId = 999999;
      milestones = JSON.stringify([
        { id: 75, threshold: 1000, rewardType: 'ENERGY', rewardValue: '1' },
        { id: 50, threshold: 2000, rewardType: 'ENERGY', rewardValue: '2' },
        { id: 25, threshold: 3000, rewardType: 'ENERGY', rewardValue: '3' },
      ]);
    } else {
      activityId = result.rows[0].id;
      milestones = JSON.stringify(result.rows[0].milestones);
      log('OK', `Found activity #${activityId} with ${(result.rows[0].milestones ?? []).length} milestones`);
    }
  } catch (err) {
    log('FAIL', `Activity query failed: [${err.code ?? 'UNKNOWN'}] ${err.message}`);
    exitCode = 1;
    await shutdown();
    return;
  }

  separator('STEP 6 — Execute RPC: finalize_activity_milestone_rewards (dry_run=true)');
  let rpcResult;
  try {
    const query = `
      SELECT public.finalize_activity_milestone_rewards(
        $1::BIGINT,
        $2::JSONB,
        TRUE,  -- p_dry_run
        NOW()  -- p_finalized_at
      ) AS result;`;

    const result = await pgClient.query(query, [activityId, milestones]);
    rpcResult = result.rows[0]?.result;

    if (!rpcResult) {
      log('FAIL', 'RPC returned null — no data returned from function');
      exitCode = 1;
      await shutdown();
      return;
    }

    log('OK', 'RPC executed successfully');
  } catch (err) {
    log('FAIL', `RPC call failed: [${err.code ?? 'UNKNOWN'}] ${err.message}`);
    log('HINT', 'This may indicate the function is not installed. Run deploy_aws_db.mjs to initialize the schema.');
    exitCode = 1;
    await shutdown();
    return;
  }

  separator('STEP 7 — Parse & Display Dry-Run Results');

  const milestonesArr = rpcResult.milestones ?? [];
  let totalEligible = 0;
  let totalClaimable = 0;

  console.log(`\n  Activity ID : ${rpcResult.activityId}`);
  console.log(`  Dry Run     : ${rpcResult.dryRun}`);
  console.log(`  Finalized At: ${rpcResult.finalizedAt ?? 'N/A'}`);
  console.log('\n  Milestone Summary:');
  console.log('  ' + '-'.repeat(64));
  console.log('  ' + [
    'MS#'.padEnd(6),
    'Threshold'.padEnd(12),
    'Type'.padEnd(8),
    'Eligible'.padEnd(10),
    'Dry-Run Claim'.padEnd(14),
  ].join(''));
  console.log('  ' + '-'.repeat(64));

  for (const m of milestonesArr) {
    const eligible = Number(m.eligibleUsers ?? 0);
    const claimable = Number(m.newlyClaimed ?? 0);
    totalEligible += eligible;
    totalClaimable += claimable;
    console.log('  ' + [
      String(m.milestoneId).padEnd(6),
      String(m.threshold).padEnd(12),
      (m.rewardType ?? '?').padEnd(8),
      String(eligible).padEnd(10),
      String(claimable).padEnd(14),
    ].join(''));
  }
  console.log('  ' + '-'.repeat(64));
  console.log('  ' + [
    'TOTAL'.padEnd(6),
    ''.padEnd(12),
    ''.padEnd(8),
    String(totalEligible).padEnd(10),
    String(totalClaimable).padEnd(14),
  ].join(''));
  console.log('');

  separator('FINAL RESULT');
  console.log('\n  ┌─────────────────────────────────────────────────────────────┐');
  console.log('  │ PASS — Tunnel, DB connection, and dry-run RPC all succeeded  │');
  console.log('  └─────────────────────────────────────────────────────────────┘\n');
  console.log('  You may now run `npm run dev` (with dev_tunnel.mjs active) to');
  console.log('  develop against the live AWS VPC.\n');

  exitCode = 0;
  await shutdown();
  process.exit(exitCode);
}

run().catch(async (err) => {
  log('FATAL', err instanceof Error ? err.message : String(err));
  await shutdown();
  process.exit(1);
});
