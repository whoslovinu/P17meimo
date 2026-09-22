#!/usr/bin/env node
/**
 * apply_migration17.mjs
 *
 * Apply migration 17 (milestone_rewards.admin_bypass) via the SSH tunnel
 * that `scripts/dev_tunnel.mjs` establishes.
 *
 * Uses the same pg driver and SSL config as scripts/inject_sql.mjs
 * so it works without psql.
 *
 * Usage:
 *   1. Start tunnel: node scripts/dev_tunnel.mjs  (leave running)
 *   2. Apply migration: node scripts/apply_migration17.mjs
 *   3. Verify: psql (or inspect the column)
 *
 * Idempotent: re-running when columns already exist prints confirmation and exits 0.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
const { Client } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));

// Same connection config as inject_sql.mjs
const RAW_CONN_STRING =
  process.env.DATABASE_URL ||
  'postgresql://postgres:PhbcRcx5Wt@127.0.0.1:5433/postgres';

const MIGRATION_FILE = resolve(__dirname, '../supabase/migrations/17_milestone_admin_bypass.sql');

function mask(s) {
  return s
    .replace(/(password=)([^&]+)/gi, '$1***')
    .replace(/(postgresql:\/\/[^:]+:)([^@]+)(@)/, '$1***$3');
}

function buildConfig(connStr) {
  const url = new URL(connStr);
  if (!url.searchParams.has('sslmode')) {
    url.searchParams.set('sslmode', 'require');
    url.searchParams.set('uselibpqcompat', 'true');
  }
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
  };
}

async function applyMigration() {
  console.log('\n[M17] Target:', mask(RAW_CONN_STRING));
  console.log('[M17] Migration file:', MIGRATION_FILE);

  if (!existsSync(MIGRATION_FILE)) {
    console.error('[M17] ERROR: migration file not found:', MIGRATION_FILE);
    process.exit(1);
  }

  const migrationSQL = readFileSync(MIGRATION_FILE, 'utf-8').trim();
  console.log('[M17] Migration SQL preview:');
  for (const line of migrationSQL.split('\n').slice(0, 8)) {
    console.log('  ', line);
  }

  const config = buildConfig(RAW_CONN_STRING);
  const client = new Client(config);

  try {
    await client.connect();
    console.log('[M17] Connected.');
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.error('[M17] ERROR: Cannot connect to tunnel on 5433.');
      console.error('[M17] Make sure `node scripts/dev_tunnel.mjs` is running first.');
    }
    throw err;
  }

  // Check existing columns
  const check = await client.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_name = 'milestone_rewards'
        AND column_name IN ('admin_bypass', 'admin_bypass_source')
      ORDER BY column_name`
  );
  const existing = new Set(check.rows.map(r => r.column_name));

  // REPARK 7.0 (2026-09-15): Check each column independently.
  // Production currently has admin_bypass but is missing admin_bypass_source
  // (partial migration state from a previous deployment attempt).
  // We must NOT exit early when the first column is present.
  const hasBypass = existing.has('admin_bypass');
  const hasSource = existing.has('admin_bypass_source');

  if (hasBypass && hasSource) {
    console.log('[M17] Both columns exist — migration fully applied. Nothing to do.');
    console.log('[M17] Existing columns:', [...existing].join(', '));
    await client.end();
    console.log('[M17] Exit 0 (idempotent — no changes made).');
    return;
  }

  if (hasBypass && !hasSource) {
    console.log('[M17] admin_bypass exists but admin_bypass_source is missing — applying partial fix...');
    try {
      await client.query(
        `ALTER TABLE public.milestone_rewards ADD COLUMN IF NOT EXISTS admin_bypass_source TEXT DEFAULT NULL`
      );
      console.log('[M17] admin_bypass_source column added.');
    } catch (err) {
      console.error('[M17] ERROR adding admin_bypass_source:', err.message);
      process.exit(2);
    }

    // Also check for the partial-migration index
    try {
      const idxCheck = await client.query(
        `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_milestone_rewards_admin_bypass'`
      );
      if (idxCheck.rowCount === 0) {
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_milestone_rewards_admin_bypass
             ON public.milestone_rewards (user_id) WHERE admin_bypass = TRUE`
        );
        console.log('[M17] Index created.');
      } else {
        console.log('[M17] Index already exists.');
      }
    } catch (err) {
      console.warn('[M17] Index check/create warning:', err.message);
    }

    await client.end();
    console.log('[M17] Partial migration complete. Exit 0.');
    return;
  }

  console.log('[M17] Columns not found. Applying full migration...');

  try {
    await client.query(migrationSQL);
    console.log('[M17] Migration SQL executed successfully.');
  } catch (err) {
    console.error('[M17] ERROR during migration:', err.message);
    process.exit(2);
  }

  // Verify
  const verify = await client.query(
    `SELECT column_name, data_type, column_default
       FROM information_schema.columns
      WHERE table_name = 'milestone_rewards'
        AND column_name IN ('admin_bypass', 'admin_bypass_source')
      ORDER BY column_name`
  );
  console.log('[M17] Verification — new columns:');
  for (const r of verify.rows) {
    console.log('  ', r.column_name, r.data_type, 'default:', r.column_default);
  }

  // Test atomic upsert still works (no data loss)
  const testRow = await client.query(
    `SELECT admin_bypass FROM public.milestone_rewards LIMIT 1`
  );
  console.log('[M17] Existing rows admin_bypass value:', testRow.rows[0]?.admin_bypass ?? '(no rows)');

  await client.end();
  console.log('[M17] Exit 0. Migration applied and verified.');
}

applyMigration().catch(err => {
  console.error('\n[M17] FATAL:', err.message);
  process.exit(1);
});
