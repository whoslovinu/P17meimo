// scripts/drift-data-contract-check.mjs
// READ ONLY data contract check for #83/#84 numeric UID contract.
// - SSH-tunnels to production RDS through bastion
// - Wraps every SELECT in a READ ONLY transaction
// - Never executes INSERT/UPDATE/DELETE/DDL
// - Never logs the password
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import pg from 'pg';
import { Client as SshClient } from 'ssh2';

const PROD_HOST = 'rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com';
const PROD_PORT = 5432;
const PROD_DB   = 'postgres';
const PROD_USER = 'postgres';

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USER = 'ubuntu';
const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const PASSPHRASE = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;

function log(label, msg) { console.log(`[${label}] ${msg}`); }
function redactedEnv(k, v) {
  if (!v) return `${k}=<missing>`;
  return `${k}=${v.substring(0, 6)}…(${v.length} chars)`;
}

function parseDotEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const k = line.substring(0, eq).trim();
    let v = line.substring(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.substring(1, v.length - 1);
    }
    out[k] = v;
  }
  return out;
}

async function readProdEnv() {
  const text = await readFile(path.resolve('.env.production'), 'utf8');
  return parseDotEnv(text);
}

// SSH tunnel: forward 127.0.0.1:15432 -> PROD_HOST:PROD_PORT through bastion.
// Returns { client, port } once listener is ready.
async function openSshTunnel() {
  const privateKey = await readFile(KEY_PATH, 'utf8');
  const client = new SshClient();
  await new Promise((resolve, reject) => {
    client.on('ready', resolve);
    client.on('error', reject);
    client.connect({
      host: BASTION_HOST, port: BASTION_PORT, username: BASTION_USER,
      privateKey, passphrase: PASSPHRASE, readyTimeout: 15000,
    });
  });
  log('SSH', 'Tunnel: connected to bastion');

  // Open a local listener
  const server = net.createServer((sock) => {
    client.forwardOut(sock.remoteAddress, sock.remotePort, PROD_HOST, PROD_PORT, (err, stream) => {
      if (err) { sock.destroy(); return; }
      sock.pipe(stream);
      stream.pipe(sock);
      sock.on('close', () => stream.end());
      stream.on('close', () => sock.end());
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  log('SSH', `Tunnel: local listener on 127.0.0.1:${port}`);

  return {
    client, server,
    port,
    cleanup: async () => {
      try { server.close(); } catch {}
      try { client.end(); } catch {}
    },
  };
}

async function main() {
  const env = await readProdEnv();
  log('ENV', redactedEnv('DATABASE_URL', env.DATABASE_URL));
  log('ENV', `PROD_HOST=${PROD_HOST}`);
  log('ENV', `PROD_DB=${PROD_DB} PROD_USER=${PROD_USER}`);

  const password = env.POSTGRES_PASSWORD || extractPassword(env.DATABASE_URL);
  if (!password) throw new Error('No POSTGRES_PASSWORD in .env.production');

  const tunnel = await openSshTunnel();

  const client = new pg.Client({
    host: '127.0.0.1',
    port: tunnel.port,
    database: PROD_DB,
    user: PROD_USER,
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    await client.connect();
    log('PG', 'Connected through SSH tunnel');

    await client.query("SET default_transaction_read_only = on;");
    log('PG', "SET default_transaction_read_only = on");

    // STEP 1: /api/time baseline
    const apiTimeUrl = (env.PROD_PUBLIC_URL
      ? `${env.PROD_PUBLIC_URL.replace(/\/$/, '')}/api/time`
      : null);
    log('STEP1', apiTimeUrl ? `URL=${apiTimeUrl}` : 'NO PROD_PUBLIC_URL configured');
    let apiBaseline = null;
    if (apiTimeUrl) {
      try {
        const r = await fetch(apiTimeUrl, { method: 'GET' });
        apiBaseline = { status: r.status, body: (await r.text()).substring(0, 400) };
      } catch (e) {
        apiBaseline = { error: String(e).substring(0, 200) };
      }
    } else {
      apiBaseline = { skipped: 'no PROD_PUBLIC_URL' };
    }
    log('STEP1', `result=${JSON.stringify(apiBaseline)}`);

    // STEP 2: coverage
    const cov = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE alias_type='master_long')              AS master_long_rows,
        COUNT(DISTINCT uuid) FILTER (WHERE alias_type='master_long') AS users_with_master_long,
        (SELECT COUNT(*) FROM public.users)                          AS users_total,
        (SELECT COUNT(*) FROM public.user_alias)                     AS alias_rows_total
      FROM public.user_alias
    `);
    const c = cov.rows[0];

    // STEP 3: gap count
    const gap = await client.query(`
      SELECT COUNT(*)::bigint AS missing_count
      FROM public.users u
      WHERE NOT EXISTS (
        SELECT 1 FROM public.user_alias ua
        WHERE ua.uuid = u.id
          AND ua.alias_type = 'master_long'
      )
    `);

    // STEP 5: probe UID 84 + alias type distribution
    const probe = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE alias_type='master_long' AND alias_value='84') AS alias_84_count,
        COUNT(*) FILTER (WHERE alias_type='master_long' AND alias_value IS NOT NULL) AS non_null_master_long,
        COUNT(DISTINCT alias_value) FILTER (WHERE alias_type='master_long')        AS distinct_master_long_values
      FROM public.user_alias
    `);

    const types = await client.query(`
      SELECT alias_type, COUNT(*)::bigint AS cnt
      FROM public.user_alias
      GROUP BY alias_type
      ORDER BY cnt DESC
    `);

    const usersTotal = Number(c.users_total);
    const usersWithMasterLong = Number(c.users_with_master_long);
    const coveragePct = usersTotal > 0
      ? Math.round((usersWithMasterLong / usersTotal) * 10000) / 100
      : null;

    const result = {
      apiTime: apiBaseline,
      master_long_rows: Number(c.master_long_rows),
      users_with_master_long: usersWithMasterLong,
      users_total: usersTotal,
      alias_rows_total: Number(c.alias_rows_total),
      coverage_percent: coveragePct,
      missing_master_long_count: Number(gap.rows[0].missing_count),
      alias_84_count: Number(probe.rows[0].alias_84_count),
      non_null_master_long: Number(probe.rows[0].non_null_master_long),
      distinct_master_long_values: Number(probe.rows[0].distinct_master_long_values),
      alias_type_distribution: types.rows,
    };
    console.log('\n=== RESULT_JSON ===');
    console.log(JSON.stringify(result, null, 2));
    console.log('=== END ===');
  } finally {
    try { await client.end(); } catch {}
    await tunnel.cleanup();
    log('PG', 'Disconnected');
  }
}

function extractPassword(url) {
  if (!url) return null;
  const m = url.match(/^postgresql:\/\/[^:]+:([^@]+)@/);
  return m ? m[1] : null;
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });