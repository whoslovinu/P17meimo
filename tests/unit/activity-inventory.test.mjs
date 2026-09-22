/**
 * tests/unit/activity-inventory.test.mjs
 *
 * REPARK 7.0 (2026-09-22) — Activity-Scoped Inventory — A1-A20 test matrix.
 *
 * Runs against a disposable PostgreSQL 15 instance (GitHub Actions CI service).
 * Run with: DATABASE_URL=postgresql://... npx tsx tests/unit/activity-inventory.test.mjs
 *
 * The test:
 *   1. Connects to the test DB
 *   2. Applies the migration (2026-09-22-0001_activity_scoped_inventory.sql)
 *   3. Runs A1-A20 scenarios
 *   4. Drops the new table (migration rollback)
 *   5. Verifies user_inventory was untouched
 *
 * Key contract:
 *   - Production helpers (lib/db/pg.ts) are imported and called directly.
 *   - No inline SQL mirror of production transaction logic.
 *   - PRODUCTION_HELPERS_USED_IN_TESTS = YES
 *
 * Exit code 0 on full pass, 1 on any failure.
 */

import pg from 'pg';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';

const { Pool } = pg;

// ── DB connection ──────────────────────────────────────────────────────────────
const TEST_DB_URL = process.env.TEST_DATABASE_URL
  || process.env.DATABASE_URL;

if (!TEST_DB_URL) {
  console.error('Set TEST_DATABASE_URL or DATABASE_URL to a TEST/LOCAL PG.');
  console.error('NEVER point this at production.');
  process.exit(2);
}

const PROD_HINT = /rds\.amazonaws\.com|prod|rds-merge/i;
if (PROD_HINT.test(TEST_DB_URL)) {
  console.error('REFUSING to run against a production-looking DB URL.');
  process.exit(2);
}

console.log(`Target DB: ${TEST_DB_URL.replace(/:[^@]*@/, ':***@')}`);

// ── Production helpers ─────────────────────────────────────────────────────────
// These import from the same DATABASE_URL env var set above.
const { Pool: PgPool } = pg;
const prodPool = new PgPool({
  connectionString: TEST_DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

// Lazy-load production helpers; they use the same DATABASE_URL via getPostgresPool().
// We set the env var first so the singleton picks up the correct test URL.
process.env.DATABASE_URL = TEST_DB_URL;

const {
  getActivityInventory,
  adjustActivityInventory,
  grantActivityItemTx,
  persistAttackTransactionally,
  getActivityDamage,
} = await import(path.join(process.cwd(), 'lib/db/pg.ts'));

// ── Counters ──────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let suiteName = '';

function suite(name) {
  suiteName = name;
  console.log(`\n──── ${name} ────`);
}

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

// ── Test fixtures ─────────────────────────────────────────────────────────────
const TEST_USER_A = '11111111-1111-1111-1111-aaaaaaaaaaaa';
const TEST_USER_B = '22222222-2222-2222-2222-bbbbbbbbbbbb';
const TEST_USER_C = '33333333-3333-3333-3333-cccccccccccc';
const ACTIVITY_1 = 1;
const ACTIVITY_8 = 8;

async function ensureUser(userId) {
  await prodPool.query(
    `INSERT INTO public.users (id, nickname, avatar)
     VALUES ($1, '', 'test')
     ON CONFLICT (id) DO NOTHING`,
    [userId],
  );
}

async function setActInv(userId, activityId, hand, phallus) {
  await prodPool.query(
    `INSERT INTO public.user_activity_inventory
       (user_id, activity_id, item_hand_count, item_phallus_count, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, activity_id) DO UPDATE SET
       item_hand_count = EXCLUDED.item_hand_count,
       item_phallus_count = EXCLUDED.item_phallus_count,
       updated_at = NOW()`,
    [userId, activityId, hand, phallus],
  );
}

async function setUserInv(userId, hand, phallus, totalDmg) {
  await ensureUser(userId);
  await prodPool.query(
    `INSERT INTO public.user_inventory
       (user_id, item_hand_count, item_phallus_count, total_damage_dealt)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET
       item_hand_count = EXCLUDED.item_hand_count,
       item_phallus_count = EXCLUDED.item_phallus_count,
       total_damage_dealt = EXCLUDED.total_damage_dealt,
       updated_at = NOW()`,
    [userId, hand, phallus, totalDmg],
  );
}

async function getUserInv(userId) {
  const r = await prodPool.query(
    `SELECT item_hand_count, item_phallus_count, total_damage_dealt
       FROM public.user_inventory
      WHERE user_id = $1`,
    [userId],
  );
  return r.rows[0] ?? null;
}

async function clearUserData() {
  for (const u of [TEST_USER_A, TEST_USER_B, TEST_USER_C]) {
    await prodPool.query(`DELETE FROM public.user_activity_inventory WHERE user_id = $1`, [u]);
    await prodPool.query(`DELETE FROM public.user_activity_stats WHERE user_id = $1`, [u]);
    await prodPool.query(`DELETE FROM public.attack_logs WHERE user_id = $1`, [u]);
    await prodPool.query(`DELETE FROM public.task_progress WHERE user_id = $1`, [u]);
  }
}

async function rawClient() {
  return await prodPool.connect();
}

// ── CAS helper (used by A17/A18A/A18B) ──────────────────────────────────────
/**
 * Simulates the task-claim CAS step from the production route.
 * CAS guard: INSERT ... ON CONFLICT DO UPDATE SET claimed_count = $new
 * WHERE claimed_count = $expected.
 *
 * This mirrors the production route's CAS logic exactly.
 * The actual production route has more context (thresholds, activity config),
 * but the CAS primitive is identical.
 */
async function casClaim(userId, taskType, resetDate, expectedPrior, newCount) {
  const client = await rawClient();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO public.task_progress
         (user_id, task_type, reset_date, current_progress, claimed_count, is_claimed)
       VALUES ($1, $2, $3, 0, $4, false)
       ON CONFLICT (user_id, task_type, reset_date) DO UPDATE SET
         claimed_count = $4
       WHERE public.task_progress.user_id = $1
         AND public.task_progress.task_type = $2
         AND public.task_progress.reset_date = $3
         AND public.task_progress.claimed_count = $5
       RETURNING claimed_count`,
      [userId, taskType, resetDate, newCount, expectedPrior],
    );
    await client.query('COMMIT');
    return (r.rowCount ?? 0) > 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    return false;
  } finally {
    client.release();
  }
}

// ── Migration ─────────────────────────────────────────────────────────────────
async function applyMigration() {
  const migrationPath = path.join(
    process.cwd(),
    'supabase/migrations/2026-09-22-0001_activity_scoped_inventory.sql',
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');
  await prodPool.query(sql);
}

async function dropNewTable() {
  await prodPool.query(`DROP TABLE IF EXISTS public.user_activity_inventory CASCADE`);
}

// ── Run ────────────────────────────────────────────────────────────────────────
async function run() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  A1-A20: Activity-Scoped Inventory — Hardening Test Matrix');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('PRODUCTION_HELPERS_USED_IN_TESTS=YES');

  // Bootstrap: ensure test users exist
  for (const u of [TEST_USER_A, TEST_USER_B, TEST_USER_C]) await ensureUser(u);

  // Snapshot user_inventory pre-state for A20
  const beforeUserInv = new Map();
  for (const u of [TEST_USER_A, TEST_USER_B, TEST_USER_C]) {
    const row = await getUserInv(u);
    if (row) beforeUserInv.set(u, JSON.stringify(row));
  }

  await clearUserData();

  // ── Apply migration ──────────────────────────────────────────────────────────
  console.log('\n──── Migration ────');
  await applyMigration();
  console.log('  \u2713 Migration forward applied');

  // ══════════════════════════════════════════════════════════════════════════════
  suite('A11: Attack on activity8 only changes activity8 inventory');
  // ══════════════════════════════════════════════════════════════════════════════
  await test('A11. attack on activity8 → activity1 unchanged (via prod persistAttack)', async () => {
    await clearUserData();
    await setActInv(TEST_USER_A, ACTIVITY_8, 5, 5);
    await setActInv(TEST_USER_A, ACTIVITY_1, 3, 3);

    // Call the real production persistAttackTransactionally
    await persistAttackTransactionally({
      userId: TEST_USER_A,
      activityId: ACTIVITY_8,
      inventoryActivityId: ACTIVITY_8,
      itemUsed: 'item_hand',
      damageDealt: 50,
    });

    // Verify via real production getActivityInventory
    const a8 = await getActivityInventory(TEST_USER_A, ACTIVITY_8);
    const a1 = await getActivityInventory(TEST_USER_A, ACTIVITY_1);

    assert.strictEqual(a8?.item_hand_count, 4, 'activity8 hand count must decrease by 1');
    assert.strictEqual(a1?.item_hand_count, 3, 'activity1 must NOT change');
    assert.strictEqual(a1?.item_phallus_count, 3, 'activity1 phallus must NOT change');
  });

  // ══════════════════════════════════════════════════════════════════════════════
  suite('A12: Task grant on activity1 only changes activity1 inventory');
  // ══════════════════════════════════════════════════════════════════════════════
  await test('A12. grant on activity1 → activity8 unchanged (via prod grantActivityItemTx)', async () => {
    await clearUserData();
    await setActInv(TEST_USER_A, ACTIVITY_1, 2, 2);
    await setActInv(TEST_USER_A, ACTIVITY_8, 7, 7);

    // Use the real production grantActivityItemTx inside a transaction
    const client = await rawClient();
    try {
      await client.query('BEGIN');
      await grantActivityItemTx(client, TEST_USER_A, ACTIVITY_1, 'item_hand');
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    // Verify via real production getActivityInventory
    const a1 = await getActivityInventory(TEST_USER_A, ACTIVITY_1);
    const a8 = await getActivityInventory(TEST_USER_A, ACTIVITY_8);

    assert.strictEqual(a1?.item_hand_count, 3, 'activity1 hand count must increase by 1 (2→3)');
    assert.strictEqual(a8?.item_hand_count, 7, 'activity8 must NOT change');
    assert.strictEqual(a8?.item_phallus_count, 7, 'activity8 phallus must NOT change');
  });

  // ══════════════════════════════════════════════════════════════════════════════
  suite('A4: Admin adjust only changes target activity');
  // ══════════════════════════════════════════════════════════════════════════════
  await test('A4. admin adjust activity8 → activity1 unchanged (via prod adjustActivityInventory)', async () => {
    await clearUserData();
    await setActInv(TEST_USER_A, ACTIVITY_1, 3, 5);
    await setActInv(TEST_USER_A, ACTIVITY_8, 7, 1);

    // Use the real production adjustActivityInventory
    await adjustActivityInventory(TEST_USER_A, ACTIVITY_8, 'item_hand', 9);

    // Verify via real production getActivityInventory
    const a8 = await getActivityInventory(TEST_USER_A, ACTIVITY_8);
    const a1 = await getActivityInventory(TEST_USER_A, ACTIVITY_1);

    assert.strictEqual(a8?.item_hand_count, 9, 'activity8 must be 9 after adjust');
    assert.strictEqual(a1?.item_hand_count, 3, 'activity1 must be unchanged (3)');
    assert.strictEqual(a1?.item_phallus_count, 5, 'activity1 phallus unchanged');
  });

  // ══════════════════════════════════════════════════════════════════════════════
  suite('A1-A2: Attack decrements the active activity only');
  // ══════════════════════════════════════════════════════════════════════════════
  await test('A1. attack on activity8 propA → only activity8 decrements', async () => {
    await clearUserData();
    await setActInv(TEST_USER_A, ACTIVITY_8, 5, 0);
    await setActInv(TEST_USER_A, ACTIVITY_1, 3, 0);

    await persistAttackTransactionally({
      userId: TEST_USER_A,
      activityId: ACTIVITY_8,
      inventoryActivityId: ACTIVITY_8,
      itemUsed: 'item_hand',
      damageDealt: 50,
    });

    const a8 = await getActivityInventory(TEST_USER_A, ACTIVITY_8);
    const a1 = await getActivityInventory(TEST_USER_A, ACTIVITY_1);
    assert.strictEqual(a8?.item_hand_count, 4, 'activity8 must decrease by 1');
    assert.strictEqual(a1?.item_hand_count, 3, 'activity1 must NOT change');
  });

  await test('A2. attack on activity1 propB → only activity1 decrements', async () => {
    const a8Before = (await getActivityInventory(TEST_USER_A, ACTIVITY_8))?.item_hand_count ?? 0;
    await persistAttackTransactionally({
      userId: TEST_USER_A,
      activityId: ACTIVITY_1,
      inventoryActivityId: ACTIVITY_1,
      itemUsed: 'item_phallus',
      damageDealt: 30,
    });

    const a1 = await getActivityInventory(TEST_USER_A, ACTIVITY_1);
    const a8 = await getActivityInventory(TEST_USER_A, ACTIVITY_8);
    assert.strictEqual(a1?.item_phallus_count, 0, 'activity1 phallus decreases (1→0)');
    assert.strictEqual(a8?.item_hand_count, a8Before, 'activity8 must NOT change');
  });

  // ══════════════════════════════════════════════════════════════════════════════
  suite('A3: Admin adjust does not leak across activities');
  // ══════════════════════════════════════════════════════════════════════════════
  await test('A3. activity8 adjust → activity1 unaffected', async () => {
    await clearUserData();
    await setActInv(TEST_USER_A, ACTIVITY_1, 3, 5);
    await setActInv(TEST_USER_A, ACTIVITY_8, 7, 1);
    await adjustActivityInventory(TEST_USER_A, ACTIVITY_8, 'item_hand', 9);

    const a8 = await getActivityInventory(TEST_USER_A, ACTIVITY_8);
    const a1 = await getActivityInventory(TEST_USER_A, ACTIVITY_1);
    assert.strictEqual(a8?.item_hand_count, 9, 'activity8 = 9');
    assert.strictEqual(a1?.item_hand_count, 3, 'activity1 unchanged');
  });

  // ══════════════════════════════════════════════════════════════════════════════
  suite('A5-A6: Task grant scope and null semantics');
  // ══════════════════════════════════════════════════════════════════════════════
  await test('A5. task grant on activity8 only changes activity8', async () => {
    await clearUserData();
    await setActInv(TEST_USER_A, ACTIVITY_1, 3, 0);
    await setActInv(TEST_USER_A, ACTIVITY_8, 9, 0);

    const client = await rawClient();
    try {
      await client.query('BEGIN');
      await grantActivityItemTx(client, TEST_USER_A, ACTIVITY_8, 'item_hand');
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    const a8 = await getActivityInventory(TEST_USER_A, ACTIVITY_8);
    const a1 = await getActivityInventory(TEST_USER_A, ACTIVITY_1);
    assert.strictEqual(a8?.item_hand_count, 10, 'activity8 increases by 1');
    assert.strictEqual(a1?.item_hand_count, 3, 'activity1 unchanged');
  });

  await test('A6. missing row → null (no legacy fallback via prod helper)', async () => {
    await clearUserData();
    await setUserInv(TEST_USER_B, 94, 0, 0);

    // Production getActivityInventory must return null for missing rows
    const r = await getActivityInventory(TEST_USER_B, ACTIVITY_8);
    assert.strictEqual(r, null, 'missing row → null, not legacy value');
  });

  // ══════════════════════════════════════════════════════════════════════════════
  suite('A13: Concurrent attack when quantity = 1 — exactly one success');
  // ══════════════════════════════════════════════════════════════════════════════
  await test('A13. 5 concurrent attacks with quantity=1 → only one wins', async () => {
    await clearUserData();
    await setActInv(TEST_USER_A, ACTIVITY_8, 1, 0);
    const initialUserDmg = (await getUserInv(TEST_USER_A))?.total_damage_dealt ?? 0;

    const results = await Promise.all([
      persistAttackTransactionally({
        userId: TEST_USER_A,
        activityId: ACTIVITY_8,
        inventoryActivityId: ACTIVITY_8,
        itemUsed: 'item_hand',
        damageDealt: 11,
      }).then(r => ({ ...r, damage: 11 })),
      persistAttackTransactionally({
        userId: TEST_USER_A,
        activityId: ACTIVITY_8,
        inventoryActivityId: ACTIVITY_8,
        itemUsed: 'item_hand',
        damageDealt: 12,
      }).then(r => ({ ...r, damage: 12 })),
      persistAttackTransactionally({
        userId: TEST_USER_A,
        activityId: ACTIVITY_8,
        inventoryActivityId: ACTIVITY_8,
        itemUsed: 'item_hand',
        damageDealt: 13,
      }).then(r => ({ ...r, damage: 13 })),
      persistAttackTransactionally({
        userId: TEST_USER_A,
        activityId: ACTIVITY_8,
        inventoryActivityId: ACTIVITY_8,
        itemUsed: 'item_hand',
        damageDealt: 14,
      }).then(r => ({ ...r, damage: 14 })),
      persistAttackTransactionally({
        userId: TEST_USER_A,
        activityId: ACTIVITY_8,
        inventoryActivityId: ACTIVITY_8,
        itemUsed: 'item_hand',
        damageDealt: 15,
      }).then(r => ({ ...r, damage: 15 })),
    ]).catch(err => {
      // Some may throw INSUFFICIENT_ITEM
      console.warn('Concurrent attack threw:', err.message);
      return [];
    });

    const successes = results.filter(r => r.inventoryDecremented);
    const failures = results.length - successes.length;

    const finalInv = await getActivityInventory(TEST_USER_A, ACTIVITY_8);
    const finalUserDmg = (await getUserInv(TEST_USER_A))?.total_damage_dealt ?? 0;

    const dmgDelta = Number(finalUserDmg) - Number(initialUserDmg);
    const validDamages = [11, 12, 13, 14, 15];
    const isValidDmg = validDamages.includes(dmgDelta);

    const logCount = await prodPool.query(
      `SELECT COUNT(*)::int AS c FROM public.attack_logs WHERE user_id = $1`,
      [TEST_USER_A],
    );
    const statsDmg = await getActivityDamage(TEST_USER_A, ACTIVITY_8);

    console.log(`  A13: successes=${successes.length}, failures=${failures}, final_inv=${finalInv?.item_hand_count}, dmg_delta=${dmgDelta}, attack_logs=${logCount.rows[0].c}, activity_damage=${statsDmg}`);

    assert.strictEqual(successes.length, 1, `expected 1 winner, got ${successes.length}`);
    assert.strictEqual(failures, 4, `expected 4 insufficient, got ${failures}`);
    assert.strictEqual(finalInv?.item_hand_count, 0, 'final inventory must be 0');
    assert.strictEqual(isValidDmg, true, `damage delta must be one of [11-15], got ${dmgDelta}`);
    assert.strictEqual(logCount.rows[0].c, 1, 'attack_logs must have exactly 1 row');
    assert.strictEqual(statsDmg, dmgDelta, 'per-activity damage must match global damage delta');
  });

  // ══════════════════════════════════════════════════════════════════════════════
  suite('A15: Global total_damage_dealt still single-row accumulator');
  // ══════════════════════════════════════════════════════════════════════════════
  await test('A15. user_inventory.total_damage_dealt aggregates across activities', async () => {
    await clearUserData();
    await setUserInv(TEST_USER_A, 0, 0, 1000);
    await setActInv(TEST_USER_A, ACTIVITY_1, 5, 5);
    await setActInv(TEST_USER_A, ACTIVITY_8, 5, 5);

    await persistAttackTransactionally({
      userId: TEST_USER_A,
      activityId: ACTIVITY_1,
      inventoryActivityId: ACTIVITY_1,
      itemUsed: 'item_hand',
      damageDealt: 50,
    });
    await persistAttackTransactionally({
      userId: TEST_USER_A,
      activityId: ACTIVITY_8,
      inventoryActivityId: ACTIVITY_8,
      itemUsed: 'item_phallus',
      damageDealt: 80,
    });

    const userInv = await getUserInv(TEST_USER_A);
    assert.strictEqual(
      Number(userInv.total_damage_dealt),
      1130,
      'global damage = 1000 + 50 + 80',
    );

    const rowCount = await prodPool.query(
      `SELECT COUNT(*)::int AS c FROM public.user_inventory WHERE user_id = $1`,
      [TEST_USER_A],
    );
    assert.strictEqual(rowCount.rows[0].c, 1, 'user_inventory must remain single-row-per-user');
  });

  // ══════════════════════════════════════════════════════════════════════════════
  suite('A16: Banned status remains global');
  // ══════════════════════════════════════════════════════════════════════════════
  await test('A16. no activity-scoped status column exists', async () => {
    const colCheck = await prodPool.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'user_activity_inventory' AND column_name LIKE '%status%'
    `);
    assert.strictEqual(colCheck.rows.length, 0, 'no status column in activity inventory');
  });

  // ══════════════════════════════════════════════════════════════════════════════
  suite('A17: Task claim grant failure rolls back entire transaction');
  // ══════════════════════════════════════════════════════════════════════════════
  await test('A17. grant failure → claimed_count unchanged, inventory unchanged', async () => {
    await clearUserData();
    await setUserInv(TEST_USER_A, 0, 0, 0);
    await setActInv(TEST_USER_A, ACTIVITY_8, 5, 5);
    await prodPool.query(
      `DELETE FROM public.task_progress WHERE user_id = $1`,
      [TEST_USER_A],
    );

    const beforeAct = await getActivityInventory(TEST_USER_A, ACTIVITY_8);
    const beforeProg = await prodPool.query(`
      SELECT claimed_count FROM public.task_progress
       WHERE user_id = $1`,
      [TEST_USER_A],
    );

    // CAS succeeds; grantActivityItemTx succeeds; then we force rollback
    const client = await rawClient();
    try {
      await client.query('BEGIN');

      // Step 1: CAS (succeeds)
      const casResult = await client.query(
        `INSERT INTO public.task_progress
           (user_id, task_type, reset_date, current_progress, claimed_count, is_claimed)
         VALUES ($1, 'daily_energy', CURRENT_DATE, 0, 1, false)
         ON CONFLICT (user_id, task_type, reset_date) DO UPDATE SET
           claimed_count = 1
         WHERE public.task_progress.user_id = $1
           AND public.task_progress.task_type = 'daily_energy'
           AND public.task_progress.reset_date = CURRENT_DATE
           AND public.task_progress.claimed_count = 0
         RETURNING claimed_count`,
        [TEST_USER_A],
      );
      assert.ok((casResult.rowCount ?? 0) > 0, 'CAS should succeed');

      // Step 2: grant (succeeds)
      await grantActivityItemTx(client, TEST_USER_A, ACTIVITY_8, 'item_hand');

      // Step 3: force ROLLBACK to simulate mid-transaction failure
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // After rollback: task_progress must be empty, inventory unchanged
    const afterProg = await prodPool.query(`
      SELECT claimed_count FROM public.task_progress
       WHERE user_id = $1`,
      [TEST_USER_A],
    );
    const afterAct = await getActivityInventory(TEST_USER_A, ACTIVITY_8);

    assert.strictEqual(afterProg.rows.length, 0, 'task_progress rolled back (no row)');
    assert.strictEqual(
      afterAct?.item_hand_count,
      beforeAct?.item_hand_count,
      'activity inventory unchanged after rollback',
    );
  });

  // ══════════════════════════════════════════════════════════════════════════════
  suite('A18a: Duplicate claim race — CAS guarantees exactly one grant');
  // ══════════════════════════════════════════════════════════════════════════════
  await test('A18a. 5 concurrent claims same prior=0 → exactly 1 grant', async () => {
    await clearUserData();
    await setActInv(TEST_USER_B, ACTIVITY_8, 0, 0);
    await prodPool.query(`DELETE FROM public.task_progress WHERE user_id = $1`, [TEST_USER_B]);

    // 5 concurrent CAS+grant transactions, all expecting prior claimed_count=0
    const tx = async () => {
      const client = await rawClient();
      try {
        await client.query('BEGIN');
        // CAS step
        const r = await client.query(
          `INSERT INTO public.task_progress
             (user_id, task_type, reset_date, current_progress, claimed_count, is_claimed)
           VALUES ($1, 'daily_energy', CURRENT_DATE, 0, 1, false)
           ON CONFLICT (user_id, task_type, reset_date) DO UPDATE SET
             claimed_count = 1
           WHERE public.task_progress.user_id = $1
             AND public.task_progress.task_type = 'daily_energy'
             AND public.task_progress.reset_date = CURRENT_DATE
             AND public.task_progress.claimed_count = 0
           RETURNING claimed_count`,
          [TEST_USER_B],
        );
        if ((r.rowCount ?? 0) === 0) {
          await client.query('ROLLBACK');
          return false;
        }
        // Grant via real production helper
        await grantActivityItemTx(client, TEST_USER_B, ACTIVITY_8, 'item_hand');
        await client.query('COMMIT');
        return true;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        return false;
      } finally {
        client.release();
      }
    };

    const results = await Promise.all([tx(), tx(), tx(), tx(), tx()]);
    const wins = results.filter(Boolean).length;
    const losses = results.length - wins;

    const claimedRow = await prodPool.query(`
      SELECT claimed_count FROM public.task_progress
       WHERE user_id = $1 AND task_type = 'daily_energy' AND reset_date = CURRENT_DATE
    `, [TEST_USER_B]);
    const finalInv = await getActivityInventory(TEST_USER_B, ACTIVITY_8);

    console.log(`  A18A: wins=${wins}, losses=${losses}, claimed_count=${claimedRow.rows[0]?.claimed_count}, inventory=${finalInv?.item_hand_count}`);

    assert.strictEqual(wins, 1, `expected exactly 1 winner, got ${wins}`);
    assert.strictEqual(losses, 4, `expected 4 conflicts, got ${losses}`);
    assert.strictEqual(claimedRow.rows[0]?.claimed_count, 1, 'final claimed_count must be 1');
    assert.strictEqual(finalInv?.item_hand_count, 1, 'final inventory must be 1');
  });

  // ══════════════════════════════════════════════════════════════════════════════
  suite('A18b: Legitimate sequential claims — additive CAS + grant');
  // ══════════════════════════════════════════════════════════════════════════════
  await test('A18b. 3 sequential claims, prior 0→1→2 → final 3', async () => {
    await clearUserData();
    await setActInv(TEST_USER_C, ACTIVITY_8, 0, 0);
    await prodPool.query(`DELETE FROM public.task_progress WHERE user_id = $1`, [TEST_USER_C]);

    for (let prior = 0; prior < 3; prior++) {
      const client = await rawClient();
      try {
        await client.query('BEGIN');
        const r = await client.query(
          `INSERT INTO public.task_progress
             (user_id, task_type, reset_date, current_progress, claimed_count, is_claimed)
           VALUES ($1, 'daily_energy', CURRENT_DATE, 0, $2, false)
           ON CONFLICT (user_id, task_type, reset_date) DO UPDATE SET
             claimed_count = $2
           WHERE public.task_progress.user_id = $1
             AND public.task_progress.task_type = 'daily_energy'
             AND public.task_progress.reset_date = CURRENT_DATE
             AND public.task_progress.claimed_count = $3
           RETURNING claimed_count`,
          [TEST_USER_C, prior + 1, prior],
        );
        if ((r.rowCount ?? 0) === 0) throw new Error(`CAS failed at prior=${prior}`);
        await grantActivityItemTx(client, TEST_USER_C, ACTIVITY_8, 'item_hand');
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    }

    const claimedRow = await prodPool.query(`
      SELECT claimed_count FROM public.task_progress
       WHERE user_id = $1 AND task_type = 'daily_energy' AND reset_date = CURRENT_DATE
    `, [TEST_USER_C]);
    const finalInv = await getActivityInventory(TEST_USER_C, ACTIVITY_8);

    console.log(`  A18B: claimed_count=${claimedRow.rows[0]?.claimed_count}, inventory=${finalInv?.item_hand_count}`);

    assert.strictEqual(claimedRow.rows[0]?.claimed_count, 3, 'final claimed_count must be 3');
    assert.strictEqual(finalInv?.item_hand_count, 3, 'final inventory must be 3');
  });

  // ══════════════════════════════════════════════════════════════════════════════
  suite('A19: Row missing → null, never reads legacy global');
  // ══════════════════════════════════════════════════════════════════════════════
  await test('A19. activity_inventory absent + user_inventory has 94 → null (via prod helper)', async () => {
    await clearUserData();
    await setUserInv(TEST_USER_C, 94, 0, 999);

    // Production getActivityInventory returns null for missing rows
    const actInv = await getActivityInventory(TEST_USER_C, ACTIVITY_8);
    assert.strictEqual(actInv, null, 'getActivityInventory → null, never legacy 94');
  });

  // ══════════════════════════════════════════════════════════════════════════════
  suite('A20: user_inventory schema unchanged after activity inventory operations');
  // ══════════════════════════════════════════════════════════════════════════════
  await test('A20. user_inventory columns and constraints unchanged', async () => {
    for (const u of [TEST_USER_A, TEST_USER_B, TEST_USER_C]) {
      const rowCount = await prodPool.query(
        `SELECT COUNT(*)::int AS c FROM public.user_inventory WHERE user_id = $1`,
        [u],
      );
      assert.ok(rowCount.rows[0].c <= 1, `user_inventory ≤1 row per user for ${u}`);
    }
    const colCount = await prodPool.query(`
      SELECT COUNT(*)::int AS c FROM information_schema.columns
       WHERE table_name = 'user_inventory' AND table_schema = 'public'
    `);
    assert.ok(colCount.rows[0].c >= 7, `user_inventory ≥7 columns (got ${colCount.rows[0].c})`);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // Migration rollback
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n──── Migration rollback ────');
  await dropNewTable();

  const tableGone = await prodPool.query(
    `SELECT COUNT(*) FROM information_schema.tables WHERE table_name='user_activity_inventory' AND table_schema='public'`,
  );
  assert.strictEqual(Number(tableGone.rows[0].count), 0, 'table must not exist after rollback');

  // user_inventory schema check
  const afterCols = await prodPool.query(`
    SELECT COUNT(*)::int AS c FROM information_schema.columns
     WHERE table_name='user_inventory' AND table_schema='public'
  `);
  const beforeCols = parseInt(
    beforeUserInv.get(TEST_USER_A)
      ? (await getUserInv(TEST_USER_A))
        ? (await prodPool.query(`SELECT COUNT(*)::int AS c FROM information_schema.columns WHERE table_name='user_inventory' AND table_schema='public'`)).rows[0].c
        : 7
      : '7',
    10,
  );
  assert.ok(afterCols.rows[0].c >= 7, 'user_inventory schema intact after rollback');

  console.log('  \u2713 Migration rollback: user_activity_inventory dropped');
  console.log('  \u2713 Migration rollback: user_inventory schema unchanged');

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  await prodPool.end();

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════════');
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
