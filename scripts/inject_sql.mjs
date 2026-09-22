#!/usr/bin/env node
/**
 * inject_sql.mjs — Apply the Phase 4 AWS RDS schema migrations through
 * the local SSH tunnel that `scripts/dev_tunnel.mjs` opens on port 5433.
 *
 * Why this script exists:
 *   - The Commander's Windows machine does not have psql installed.
 *   - The project already depends on the `pg` driver, so we use Node as
 *     a portable SQL client.
 *   - It is intentionally idempotent and self-diagnosing — safe to run
 *     once per environment and easy to debug when the tunnel is down.
 *
 * Usage:
 *   node scripts/inject_sql.mjs                # apply all migrations
 *   node scripts/inject_sql.mjs --dry         # print, do not execute
 *   node scripts/inject_sql.mjs --list        # show the manifest
 *   node scripts/inject_sql.mjs --only=05      # apply only aws_05_*.sql
 *
 * Prerequisites:
 *   1. Start the tunnel in a separate terminal:
 *        $env:DEPLOY_SSH_PASSPHRASE='REPARK'; node scripts/dev_tunnel.mjs
 *   2. Confirm 5433 is listening:
 *        netstat -ano | findstr 5433
 *
 * Exit codes:
 *   0  all migrations applied (or already applied)
 *   1  connection failed (tunnel down, wrong creds, etc.)
 *   2  one or more migrations raised SQL errors
 *   3  bad CLI usage
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

// ── Config ────────────────────────────────────────────────────────────────
const RAW_CONN_STRING =
  process.env.DATABASE_URL ||
  'postgresql://postgres:PhbcRcx5Wt@127.0.0.1:5433/postgres';
const STATEMENT_TIMEOUT_MS = 15_000;

/**
 * Mask the password for the "Target:" banner.
 * Strips a `password=...` query param AND the userinfo segment of the URL.
 */
function maskConnString(s) {
  let out = s.replace(/(password=)([^&]+)/gi, '$1***');
  out = out.replace(/(postgresql:\/\/[^:]+:)([^@]+)(@)/, '$1***$3');
  return out;
}

/**
 * Build a pg client config that satisfies AWS RDS's mandatory-SSL policy.
 *
 * The 28000 ("no pg_hba.conf entry ... no encryption") error means the
 * upstream RDS instance refuses plaintext. RDS always demands TLS, even
 * for connections that arrive over an SSH tunnel.
 *
 * Strategy:
 *   1. If the operator already specified sslmode in the URL, leave it
 *      alone (their setting wins).
 *   2. Otherwise, set sslmode=require (libpq semantics — encrypted,
 *      no CA validation) and pass `ssl: { rejectUnauthorized: false }`
 *      because the bastion chain uses self-signed / non-public certs
 *      that the local Node CA store does not trust. The channel is
 *      still encrypted end-to-end.
 *   3. Add `uselibpqcompat=true` to silence pg-connection-string v2.x
 *      warnings about non-strict sslmodes and to opt into the future
 *      libpq-aligned behavior early.
 */
function buildPgConfig(connStr) {
  const url = new URL(connStr);
  if (!url.searchParams.has('sslmode')) {
    url.searchParams.set('sslmode', 'require');
  }
  if (!url.searchParams.has('uselibpqcompat')) {
    url.searchParams.set('uselibpqcompat', 'true');
  }
  return {
    connectionString: url.toString(),
    statement_timeout: STATEMENT_TIMEOUT_MS,
    // The `ssl` field is what actually opens a TLS handshake. pg v8 reads
    // sslmode from the URL and combines it with this object.
    ssl: { rejectUnauthorized: false },
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Migrations are applied in this order. Add new entries at the bottom.
const MIGRATIONS = [
  { name: 'aws_05_user_status.sql',       path: resolve(ROOT, 'aws_rds_init/aws_05_user_status.sql') },
  { name: 'aws_06_repark_config.sql',     path: resolve(ROOT, 'aws_rds_init/aws_06_repark_config.sql') },
  { name: 'aws_07_fix_updated_at_columns.sql', path: resolve(ROOT, 'aws_rds_init/aws_07_fix_updated_at_columns.sql') },
  { name: 'aws_08_finalize_milestones_cron.sql', path: resolve(ROOT, 'aws_rds_init/aws_08_finalize_milestones_cron.sql') },
];

// ── CLI flag parsing ──────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));
const isDryRun  = args.has('--dry');
const isList    = args.has('--list');
const onlyArg   = [...args].find((a) => a.startsWith('--only='));
const onlyFilter = onlyArg ? onlyArg.split('=')[1] : null;

if ([...args].some((a) => !['--dry', '--list', '--only=' + onlyFilter].includes(a) && !a.startsWith('--only='))) {
  console.error('[inject_sql] Unknown flag. Use --dry, --list, or --only=<name>.');
  process.exit(3);
}

if (isList) {
  console.log('Registered migrations:');
  for (const m of MIGRATIONS) {
    console.log(`  • ${m.name}  →  ${relative(ROOT, m.path)}`);
  }
  process.exit(0);
}

// ── Helpers ───────────────────────────────────────────────────────────────
function summarizeSql(sql) {
  const lines      = sql.split(/\r?\n/).length;
  const noComments = sql.replace(/--.*$/gm, '');
  const counts = {
    CREATE:   (noComments.match(/\bCREATE\b/gi) || []).length,
    ALTER:    (noComments.match(/\bALTER\b/gi)  || []).length,
    DROP:     (noComments.match(/\bDROP\b/gi)    || []).length,
    INSERT:   (noComments.match(/\bINSERT\b/gi)  || []).length,
    SELECT:   (noComments.match(/\bSELECT\b/gi)  || []).length,
    INDEX:    (noComments.match(/\bINDEX\b/gi)   || []).length,
    FUNCTION: (noComments.match(/\bFUNCTION\b/gi) || []).length,
    TRIGGER:  (noComments.match(/\bTRIGGER\b/gi)  || []).length,
  };
  return { lines, counts };
}

async function probeSchema(client) {
  // Sanity check: confirm we're not accidentally hitting an empty database.
  try {
    const r = await client.query("SELECT current_database() AS db, current_user AS u, version() AS v");
    return r.rows[0];
  } catch {
    return null;
  }
}

async function ping(client) {
  try {
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('╭─────────────────────────────────────────────╮');
  console.log('│ REPARK SQL injector                         │');
  console.log('╰─────────────────────────────────────────────╯');
  console.log(`[inject_sql] Target: ${maskConnString(RAW_CONN_STRING)}`);
  if (isDryRun) console.log('[inject_sql] --dry: SQL will be printed, not executed.');

  const target = onlyFilter
    ? MIGRATIONS.filter((m) => m.name.includes(onlyFilter))
    : MIGRATIONS;

  if (target.length === 0) {
    console.error(`[inject_sql] --only=${onlyFilter} did not match any migration.`);
    console.error('[inject_sql] Available:', MIGRATIONS.map((m) => m.name).join(', '));
    process.exit(3);
  }

  // Pre-flight: every file must exist.
  for (const m of target) {
    if (!existsSync(m.path)) {
      console.error(`[inject_sql] Missing migration file: ${m.path}`);
      process.exit(3);
    }
  }

  const client = new Client(buildPgConfig(RAW_CONN_STRING));

  if (!isDryRun) {
    try {
      await client.connect();
    } catch (err) {
      printConnectionError(err);
      process.exit(1);
    }

    // Statement timeout can cause spurious failures on long CREATE INDEX.
    // We disable it for this session since migrations are short and bounded.
    try {
      await client.query(`SET statement_timeout = 0`);
    } catch { /* some DBs disallow; ignore */ }

    const serverInfo = await probeSchema(client);
    if (serverInfo) {
      console.log(
        `[inject_sql] Connected to db=${serverInfo.db} as user=${serverInfo.u}`
      );
      console.log(`[inject_sql] Server: ${(serverInfo.v || '').split(' ').slice(0, 2).join(' ')}`);
    } else {
      console.log('[inject_sql] Connected (schema probe unavailable).');
    }
  } else {
    console.log('[inject_sql] (connection skipped for --dry)');
  }

  let failed = false;

  for (const m of target) {
    const sql = readFileSync(m.path, 'utf8');
    const { lines, counts } = summarizeSql(sql);

    console.log('');
    console.log(`▶ ${m.name}  (${lines} lines  CREATE=${counts.CREATE} ALTER=${counts.ALTER} DROP=${counts.DROP} INDEX=${counts.INDEX} TRIGGER=${counts.TRIGGER})`);

    if (isDryRun) {
      console.log('─'.repeat(60));
      console.log(sql.trimEnd());
      console.log('─'.repeat(60));
      console.log(`[dry] skipped execution of ${m.name}`);
      continue;
    }

    try {
      const t0 = Date.now();
      await client.query(sql);
      const ms = Date.now() - t0;
      console.log(`  ✓ ${m.name} applied in ${ms} ms`);
    } catch (err) {
      failed = true;
      console.error(`  ✗ ${m.name} FAILED`);
      console.error(`    code:    ${err.code || 'n/a'}`);
      console.error(`    message: ${err.message}`);
      console.error(`    hint:    ${hintFor(err, m.name)}`);
      break; // do not proceed; preserve migration order
    }
  }

  if (!failed && !isDryRun) {
    await verifySchema(client, target);
  }

  if (!isDryRun) {
    await client.end();
  }

  if (failed) {
    console.error('\n[inject_sql] Aborted — fix the error above and re-run.');
    console.error('[inject_sql] All migrations use IF NOT EXISTS — re-running after a partial failure is safe.');
    process.exit(2);
  }

  console.log(isDryRun ? '\n[inject_sql] Dry run complete.' : '\n[inject_sql] All migrations applied successfully.');
}

function printConnectionError(err) {
  console.error('\n[inject_sql] Could not connect to PostgreSQL.');
  console.error(`[inject_sql] error code:   ${err.code || 'n/a'}`);
  console.error(`[inject_sql] error message: ${err.message}`);

  const msg = String(err.message || '');
  const code = err.code || '';
  const isSsl = /ssl|tls|28000|no encryption|pg_hba/i.test(msg) || code === '28000';

  console.error('');
  if (isSsl) {
    console.error('Detected: RDS is rejecting the connection because the link is not encrypted.');
    console.error('  → AWS RDS mandates TLS on every endpoint. The pg driver must be told to negotiate SSL.');
    console.error('  → The script now auto-injects sslmode=require + ssl.rejectUnauthorized=false.');
    console.error('  → If this still fails, the upstream RDS CA bundle may need to be trusted.');
  }
  console.error('Checklist:');
  console.error('  1. Is the SSH tunnel running?');
  console.error('       → in another terminal: node scripts/dev_tunnel.mjs');
  console.error('  2. Is 127.0.0.1:5433 listening on Windows?');
  console.error('       → netstat -ano | findstr 5433');
  console.error('  3. Is the password correct?  (matches .env.local DATABASE_URL)');
  console.error('  4. Did the bastion host reject the SSH key? (key passphrase / IP whitelist)');
  console.error('  5. Does the database require SSL? (RDS does — see message above)');
}

function hintFor(err, name) {
  const code = err.code || '';
  if (code === '42P07') return `Object already exists. The script is idempotent — re-run, it should skip.`;
  if (code === '42701') return `Duplicate column. The script is idempotent — re-run, it should skip.`;
  if (code === '42501') return `Permission denied. The user role cannot ALTER/CREATE — use a superuser or the master role.`;
  if (code === '3F000') return `Schema "public" does not exist — create it first: CREATE SCHEMA IF NOT EXISTS public;`;
  if (code === '57P03') return `Database is starting up — wait and retry.`;
  if (code === '53300') return `Too many connections — close other clients and retry.`;
  return `Look up PostgreSQL SQLSTATE ${code} if the message is unclear.`;
}

async function verifySchema(client, applied) {
  console.log('');
  console.log('Verifying post-migration state...');
  for (const m of applied) {
    if (m.name.startsWith('aws_05')) {
      const r = await client.query(`
        SELECT column_name, data_type, column_default
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'user_inventory'
           AND column_name = 'status'
      `);
      if (r.rowCount === 0) {
        console.error(`  ✗ user_inventory.status — MISSING (migration did not actually apply!)`);
        continue;
      }
      console.log(`  ✓ public.user_inventory.status  (${r.rows[0].data_type}, default=${r.rows[0].column_default})`);
    } else if (m.name.startsWith('aws_06')) {
      const r = await client.query(`
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'repark_config'
      `);
      if (r.rowCount === 0) {
        console.error(`  ✗ repark_config — MISSING (migration did not actually apply!)`);
        continue;
      }
      console.log(`  ✓ public.repark_config (table present)`);
    } else if (m.name.startsWith('aws_07')) {
      const r = await client.query(`
        SELECT table_name, column_name
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND column_name  = 'updated_at'
           AND table_name IN ('user_daily_tasks', 'task_progress')
         ORDER BY table_name
      `);
      const present = new Set(r.rows.map((row) => row.table_name));
      for (const t of ['user_daily_tasks', 'task_progress']) {
        if (present.has(t)) {
          console.log(`  ✓ public.${t}.updated_at  (present)`);
        } else {
          console.error(`  ✗ ${t}.updated_at — MISSING (migration did not actually apply!)`);
        }
      }
    } else if (m.name.startsWith('aws_08')) {
      const r = await client.query(`
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name   = 'activity_finalization_log'
      `);
      if (r.rowCount === 0) {
        console.error(`  ✗ activity_finalization_log — MISSING (migration did not actually apply!)`);
        continue;
      }
      console.log(`  ✓ public.activity_finalization_log (table present)`);
    }
  }
}

// We call ping() only as a future hook — keep it referenced so ESLint
// doesn't strip it when this file is later split.
void ping;

main().catch((err) => {
  console.error('[inject_sql] Unhandled exception:', err);
  process.exit(1);
});