/**
 * tests/unit/migration-rollback.test.mjs
 *
 * REPARK 7.0 (2026-09-22) — Migration forward/rollback smoke test.
 *
 * Verifies:
 *   1. CREATE TABLE user_activity_inventory — succeeds
 *   2. New table can be INSERTed/UPDATEd/SELECTed
 *   3. DROP TABLE — succeeds
 *   4. user_inventory table is unchanged after both forward and rollback
 *   5. user_activity_inventory does not exist after rollback
 *
 * Run with: TEST_DATABASE_URL=... npx tsx tests/unit/migration-rollback.test.mjs
 */

import pg from 'pg';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const { Pool } = pg;

const TEST_DB_URL = process.env.TEST_DATABASE_URL
  || process.env.DATABASE_URL_LOCAL_TEST
  || process.env.DATABASE_URL;

if (!TEST_DB_URL) {
  console.error('Set TEST_DATABASE_URL to a TEST/LOCAL PG.');
  process.exit(2);
}

const PROD_HINT = /rds\.amazonaws\.com|prod|rds-merge/i;
if (PROD_HINT.test(TEST_DB_URL)) {
  console.error('REFUSING to run against production-looking DB URL.');
  process.exit(2);
}

const pool = new Pool({ connectionString: TEST_DB_URL, ssl: { rejectUnauthorized: false } });

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(async () => {
      await fn();
      passed++;
      console.log(`  \u2713 ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  \u2717 ${name}`);
      console.log(`      ${err.message}`);
    });
}

async function getColumnCount(tableName) {
  const r = await pool.query(`
    SELECT COUNT(*)::int AS c FROM information_schema.columns
     WHERE table_name = $1 AND table_schema = 'public'
  `, [tableName]);
  return r.rows[0].c;
}

async function tableExists(tableName) {
  const r = await pool.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_name = $1 AND table_schema = 'public'
    ) AS e
  `, [tableName]);
  return r.rows[0].e;
}

async function getConstraintCount(tableName) {
  const r = await pool.query(`
    SELECT COUNT(*)::int AS c FROM pg_constraint WHERE conrelid = $1::regclass
  `, [tableName]);
  return r.rows[0].c;
}

async function run() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  Migration Forward / Rollback Test');
  console.log('═══════════════════════════════════════════════════════════════════');

  // Snapshot user_inventory pre-state
  const beforeUserInvColumns = await getColumnCount('user_inventory');
  const beforeUserInvConstraints = await getConstraintCount('user_inventory');

  // Snapshot user_activity_inventory existence (likely absent)
  const beforeTableExists = await tableExists('user_activity_inventory');
  console.log(`\n  Pre-state: user_activity_inventory exists = ${beforeTableExists}`);

  // ── Migration forward ────────────────────────────────────────────────────
  console.log('\n──── Forward migration ────');

  // Read the migration SQL file
  const migrationPath = path.join(
    process.cwd(),
    'supabase/migrations/2026-09-22-0001_activity_scoped_inventory.sql',
  );
  if (!fs.existsSync(migrationPath)) {
    console.error(`Migration file not found: ${migrationPath}`);
    process.exit(2);
  }
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  await test('F1. CREATE TABLE user_activity_inventory succeeds', async () => {
    await pool.query(migrationSql);
    const exists = await tableExists('user_activity_inventory');
    assert.strictEqual(exists, true, 'table should exist after migration');
  });

  await test('F2. table has correct columns', async () => {
    const cols = await getColumnCount('user_activity_inventory');
    // 7 columns: user_id, activity_id, item_hand_count, item_phallus_count, created_at, updated_at, plus PK constraint is separate
    assert.ok(cols >= 6, `expected >= 6 columns, got ${cols}`);
  });

  await test('F3. INSERT into new table works', async () => {
    const userId = 'a0000000-0000-0000-0000-000000000001';
    const activityId = 1;
    // Ensure user exists
    await pool.query(
      `INSERT INTO public.users (id, nickname, avatar) VALUES ($1, '', 'test')
         ON CONFLICT (id) DO NOTHING`,
      [userId],
    );
    await pool.query(
      `INSERT INTO public.user_activity_inventory
         (user_id, activity_id, item_hand_count, item_phallus_count, updated_at)
       VALUES ($1, $2, 5, 3, NOW())
       ON CONFLICT (user_id, activity_id) DO UPDATE SET
         item_hand_count = EXCLUDED.item_hand_count,
         item_phallus_count = EXCLUDED.item_phallus_count`,
      [userId, activityId],
    );
    const r = await pool.query(
      `SELECT item_hand_count, item_phallus_count
         FROM public.user_activity_inventory WHERE user_id = $1 AND activity_id = $2`,
      [userId, activityId],
    );
    assert.strictEqual(r.rows[0].item_hand_count, 5);
    assert.strictEqual(r.rows[0].item_phallus_count, 3);
    // Cleanup
    await pool.query(
      `DELETE FROM public.user_activity_inventory WHERE user_id = $1`,
      [userId],
    );
  });

  // Snapshot user_inventory post-forward
  const afterForwardUserInvColumns = await getColumnCount('user_inventory');
  const afterForwardUserInvConstraints = await getConstraintCount('user_inventory');

  await test('F4. user_inventory schema unchanged after forward', async () => {
    assert.strictEqual(afterForwardUserInvColumns, beforeUserInvColumns,
      `user_inventory columns should be ${beforeUserInvColumns}, got ${afterForwardUserInvColumns}`);
    assert.strictEqual(afterForwardUserInvConstraints, beforeUserInvConstraints,
      `user_inventory constraints should be ${beforeUserInvConstraints}, got ${afterForwardUserInvConstraints}`);
  });

  // ── Migration rollback ───────────────────────────────────────────────────
  console.log('\n──── Rollback migration ────');

  await test('R1. DROP TABLE user_activity_inventory succeeds', async () => {
    await pool.query(`DROP TABLE IF EXISTS public.user_activity_inventory CASCADE`);
    const exists = await tableExists('user_activity_inventory');
    assert.strictEqual(exists, false, 'table should not exist after rollback');
  });

  const afterRollbackUserInvColumns = await getColumnCount('user_inventory');
  const afterRollbackUserInvConstraints = await getConstraintCount('user_inventory');

  await test('R2. user_inventory schema unchanged after rollback', async () => {
    assert.strictEqual(afterRollbackUserInvColumns, beforeUserInvColumns,
      `user_inventory columns should still be ${beforeUserInvColumns}, got ${afterRollbackUserInvColumns}`);
    assert.strictEqual(afterRollbackUserInvConstraints, beforeUserInvConstraints,
      `user_inventory constraints should still be ${beforeUserInvConstraints}, got ${afterRollbackUserInvConstraints}`);
  });

  await pool.end();

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════════');
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
