#!/usr/bin/env node
/**
 * scripts/inject-test-props.mjs
 *
 * REPARK 6.0 — One-shot inventory injection for Commander's dedicated test user.
 *
 * Target UID: 11111111-1111-1111-1111-111111111111
 *   - Repeated 1-pattern (no real-user-collision risk).
 *   - Reserved for Commander's manual QA only.
 *
 * Effects:
 *   1. UPSERT public.users                     (id, email, nickname, avatar, total_damage_dealt)
 *   2. UPSERT public.user_inventory            (user_id, item_hand_count, item_phallus_count,
 *                                              total_damage_dealt, status, updated_at)
 *      -> Sets BOTH counters to 9999 — enough for hundreds of attack_a / attack_b
 *         actions without needing a re-top-up.
 *
 * Idempotent: re-running this script is a no-op except for bumping
 * item_hand_count and item_phallus_count back to 9999.
 *
 * Usage:
 *   # Default: connect via SSH tunnel ports (5433) with .env credentials
 *   node scripts/inject-test-props.mjs
 *
 *   # Override DB URL
 *   DATABASE_URL=postgresql://user:pass@host:5432/db node scripts/inject-test-props.mjs
 *
 *   # Override counts
 *   PROP_COUNT=20000 node scripts/inject-test-props.mjs
 *
 * Safety:
 *   - This script WRITES to production database. Confirm the UID before running.
 *   - Wrapped in a single transaction (BEGIN / COMMIT). Any error → ROLLBACK.
 *   - Never deletes rows.
 */

import pg from 'pg';

const TARGET_UID = '11111111-1111-1111-1111-111111111111';
const PROP_COUNT = Number(process.env.PROP_COUNT || 9999);

const PG_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:PhbcRcx5Wt@127.0.0.1:5433/postgres';

// Format-only UUID validation: 8-4-4-4-12 lowercase hex.
// We intentionally do NOT enforce version (1-5) or variant (8/9/a/b) bits
// because Commander's test UID is a deliberate placeholder (all-1s pattern)
// that doesn't conform to RFC 4122 §4.4. We only need a sanity check to
// catch typos like missing dashes or stray characters.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!UUID_RE.test(TARGET_UID)) {
  console.error(`[inject-test-props] FATAL: target UID is not a valid UUID: ${TARGET_UID}`);
  process.exit(2);
}
if (!Number.isInteger(PROP_COUNT) || PROP_COUNT < 1 || PROP_COUNT > 1_000_000) {
  console.error(`[inject-test-props] FATAL: PROP_COUNT must be 1..1,000,000 (got ${PROP_COUNT})`);
  process.exit(2);
}

const log = (msg) => console.log(`[inject-test-props] ${msg}`);

async function main() {
  const c = new pg.Client({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  log(`connected → ${PG_URL.replace(/\/\/[^@]+@/, '//***@')}`);
  log(`target UID = ${TARGET_UID}`);
  log(`item counts = ${PROP_COUNT}`);

  // ── Pre-flight: sanity-check tables exist ────────────────────────────────────
  const tabs = await c.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('users','user_inventory') ORDER BY tablename"
  );
  const have = new Set(tabs.rows.map((r) => r.tablename));
  for (const t of ['users', 'user_inventory']) {
    if (!have.has(t)) {
      console.error(`[inject-test-props] FATAL: table public.${t} not found`);
      await c.end();
      process.exit(3);
    }
  }

  try {
    await c.query('BEGIN');

    // ── 1. UPSERT users row ────────────────────────────────────────────────────
    const u = await c.query(
      `INSERT INTO public.users (id, email, nickname, avatar, total_damage_dealt)
       VALUES ($1, $2, $3, $4, 0)
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email,
             nickname = EXCLUDED.nickname,
             avatar = EXCLUDED.avatar
       RETURNING id, email, nickname, avatar, created_at`,
      [TARGET_UID, 'commander@repark.local', '🎖️ Commander', '🎖️']
    );
    log(`users row: ${JSON.stringify(u.rows[0])}`);

    // ── 2. UPSERT user_inventory ───────────────────────────────────────────────
    // status enum: 'normal' | 'banned' | 'locked' (CHECK constraint).
    const inv = await c.query(
      `INSERT INTO public.user_inventory
         (user_id, item_hand_count, item_phallus_count, total_damage_dealt, status, updated_at)
       VALUES ($1, $2, $2, 0, 'normal', NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         item_hand_count    = EXCLUDED.item_hand_count,
         item_phallus_count = EXCLUDED.item_phallus_count,
         status             = EXCLUDED.status,
         updated_at         = NOW()
       RETURNING user_id, item_hand_count, item_phallus_count, status, updated_at`,
      [TARGET_UID, PROP_COUNT]
    );
    log(`inventory row: ${JSON.stringify(inv.rows[0])}`);

    await c.query('COMMIT');
    log(`✓ transaction committed`);
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('[inject-test-props] FATAL:', err.message);
    await c.end();
    process.exit(1);
  }

  // ── Post-flight: read-back verification ─────────────────────────────────────
  const v = await c.query(
    `SELECT u.id, u.email, u.nickname,
            inv.item_hand_count, inv.item_phallus_count, inv.status, inv.updated_at
     FROM public.users u
     LEFT JOIN public.user_inventory inv ON inv.user_id = u.id
     WHERE u.id = $1`,
    [TARGET_UID]
  );
  log(`read-back: ${JSON.stringify(v.rows[0])}`);

  await c.end();
  log(`DONE. Commander can now fire attack_a / attack_b freely with uid=${TARGET_UID}`);
}

main().catch(async (e) => {
  console.error('[inject-test-props] unhandled:', e);
  process.exit(1);
});
