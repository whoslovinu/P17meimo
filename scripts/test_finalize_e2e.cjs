/**
 * E2E smoke test for the finalize-milestones cron route.
 *
 *   1. Spin up a synthetic activity whose end_time is already in the past
 *      and that has one ENERGY milestone + one MEDAL milestone.
 *   2. Seed two fake users with damage totals:
 *      - user A: hits both milestones
 *      - user B: hits the first milestone only
 *      - user C: no damage (must NOT be claimed)
 *   3. Dry-run → expect eligible counts, no DB writes
 *   4. Live run → expect claims persisted in milestone_rewards + log row
 *   5. Re-run (no force) → expect skipped (already_finalized)
 *   6. force=true re-run → expect no double-claim
 *   7. Clean up.
 *
 * Usage:   node scripts/test_finalize_e2e.cjs
 */

const { Client } = require('pg');

const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:PhbcRcx5Wt@127.0.0.1:5433/postgres';

const API_BASE = 'http://localhost:3000';

const SYN_ACTIVITY = {
  id: 888001,
  name: 'E2E finalize-milestones smoke',
  start: '2026-01-01T00:00:00Z',
  end:   '2026-06-30T00:00:00Z', // well in the past
  status: 'ENABLED',
  milestones: [
    { id: 101, threshold: 100,  rewardType: 'ENERGY', rewardValue: '50' },
    { id: 102, threshold: 500,  rewardType: 'MEDAL',  rewardValue: 'gold' },
  ],
};

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const USER_C = '33333333-3333-3333-3333-333333333333';

let c;

async function api(path, body) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return { status: r.status, body: await r.json() };
}

function expect(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? '✓' : '✗'} ${label} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  if (!ok) process.exitCode = 1;
}

(async () => {
  c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log('─ Setup ─────────────────────────────────────────────');
  // Wipe any leftover from a previous run.
  await c.query(`DELETE FROM public.milestone_rewards WHERE milestone_id IN (101, 102)`);
  await c.query(`DELETE FROM public.activity_finalization_log WHERE activity_id = $1`, [SYN_ACTIVITY.id]);
  await c.query(`DELETE FROM public.user_inventory WHERE user_id = ANY($1::uuid[])`, [[USER_A, USER_B, USER_C]]);
  await c.query(`DELETE FROM public.users WHERE id = ANY($1::uuid[])`, [[USER_A, USER_B, USER_C]]);
  await c.query(`DELETE FROM public.activities WHERE id = $1`, [SYN_ACTIVITY.id]);

  await c.query(
    `INSERT INTO public.users (id, nickname) VALUES ($1,'a'),($2,'b'),($3,'c') ON CONFLICT DO NOTHING`,
    [USER_A, USER_B, USER_C]
  );
  await c.query(
    `INSERT INTO public.user_inventory (user_id, total_damage_dealt) VALUES
       ($1, 1000), ($2, 150), ($3, 0)
     ON CONFLICT (user_id) DO UPDATE SET total_damage_dealt = EXCLUDED.total_damage_dealt`,
    [USER_A, USER_B, USER_C]
  );
  await c.query(
    `INSERT INTO public.activities (id, name, type, start_time, end_time, status, config)
     VALUES ($1, $2, 'LIVE2D', $3, $4, $5, $6::jsonb)`,
    [
      SYN_ACTIVITY.id,
      SYN_ACTIVITY.name,
      SYN_ACTIVITY.start,
      SYN_ACTIVITY.end,
      SYN_ACTIVITY.status,
      JSON.stringify({ isGlobalEnabled: false, milestones: SYN_ACTIVITY.milestones }),
    ]
  );
  console.log('  Synthetic activity + 3 users seeded.');

  console.log('─ Dry run ───────────────────────────────────────────');
  const dry = await api('/api/internal/cron/finalize-milestones', {
    activityId: SYN_ACTIVITY.id,
    dryRun: true,
  });
  expect('dryRun.ok', dry.body.ok, true);
  expect('dryRun dryRun flag', dry.body.data.dryRun, true);
  const dryFinalized = dry.body.data.finalized[0];
  expect('dryRun activityId', dryFinalized?.activityId, SYN_ACTIVITY.id);
  // Milestone 101 (threshold=100): A + B both eligible → 2 users
  const m101 = dryFinalized?.milestones.find((m) => m.milestoneId === 101);
  const m102 = dryFinalized?.milestones.find((m) => m.milestoneId === 102);
  expect('dryRun m101 eligible', m101?.eligibleUsers, 2);
  expect('dryRun m101 newlyClaimed (no real writes)', m101?.newlyClaimed, 2);
  expect('dryRun m102 eligible', m102?.eligibleUsers, 1);

  // Verify NOTHING was written during dryRun
  const cnt1 = await c.query(`SELECT count(*)::int FROM public.milestone_rewards WHERE milestone_id IN (101,102)`);
  expect('dryRun wrote 0 milestone_rewards', cnt1.rows[0].count, 0);
  const cnt2 = await c.query(`SELECT count(*)::int FROM public.activity_finalization_log WHERE activity_id=$1`, [SYN_ACTIVITY.id]);
  expect('dryRun wrote 0 finalization_log', cnt2.rows[0].count, 0);

  console.log('─ Live run ──────────────────────────────────────────');
  const live = await api('/api/internal/cron/finalize-milestones', {
    activityId: SYN_ACTIVITY.id,
    dryRun: false,
  });
  expect('live.ok', live.body.ok, true);
  const liveFinalized = live.body.data.finalized[0];
  const live101 = liveFinalized.milestones.find((m) => m.milestoneId === 101);
  expect('live m101 newlyClaimed', live101.newlyClaimed, 2);
  expect('live totalClaimed', liveFinalized.totalClaimed, 3);

  // Verify persistence
  const claims = await c.query(
    `SELECT user_id, milestone_id, is_claimed FROM public.milestone_rewards WHERE milestone_id IN (101,102) ORDER BY user_id, milestone_id`
  );
  expect('claims row count', claims.rows.length, 3);
  expect('A claimed both', claims.rows.find((r) => r.user_id === USER_A && r.milestone_id === 102)?.is_claimed, true);
  expect('C not claimed', claims.rows.find((r) => r.user_id === USER_C), undefined);
  const inv = await c.query(`SELECT user_id, item_hand_count FROM public.user_inventory WHERE user_id = $1`, [USER_A]);
  expect('A got +1 hand', inv.rows[0]?.item_hand_count, 1);
  const log = await c.query(`SELECT finalized_by FROM public.activity_finalization_log WHERE activity_id=$1`, [SYN_ACTIVITY.id]);
  expect('log row written', log.rows[0]?.finalized_by, 'cron:finalize-milestones');

  console.log('─ Idempotent re-run ─────────────────────────────────');
  const rerun = await api('/api/internal/cron/finalize-milestones', { activityId: SYN_ACTIVITY.id });
  expect('rerun.ok', rerun.body.ok, true);
  expect('rerun.finalized empty (already done)', rerun.body.data.finalized.length, 0);
  expect('rerun.skipped says already_finalized',
    rerun.body.data.skipped[0]?.reason, 'already_finalized');

  console.log('─ Force re-run ──────────────────────────────────────');
  const forced = await api('/api/internal/cron/finalize-milestones', {
    activityId: SYN_ACTIVITY.id, force: true,
  });
  expect('force.finalized length', forced.body.data.finalized.length, 1);
  // No NEW claims — already-claimed users are skipped by RPC
  const forceClaims = await c.query(`SELECT count(*)::int FROM public.milestone_rewards WHERE milestone_id IN (101,102)`);
  expect('force did not double-claim', forceClaims.rows[0].count, 3);

  console.log('─ Cleanup ───────────────────────────────────────────');
  await c.query(`DELETE FROM public.milestone_rewards WHERE milestone_id IN (101, 102)`);
  await c.query(`DELETE FROM public.activity_finalization_log WHERE activity_id = $1`, [SYN_ACTIVITY.id]);
  await c.query(`DELETE FROM public.user_inventory WHERE user_id = ANY($1::uuid[])`, [[USER_A, USER_B, USER_C]]);
  await c.query(`DELETE FROM public.users WHERE id = ANY($1::uuid[])`, [[USER_A, USER_B, USER_C]]);
  await c.query(`DELETE FROM public.activities WHERE id = $1`, [SYN_ACTIVITY.id]);
  console.log('  Synthetic state removed.');

  console.log(process.exitCode ? '\n✗ FAIL' : '\n✓ PASS');
  await c.end();
})().catch(async (err) => {
  console.error('Test crashed:', err);
  // Best-effort cleanup
  try {
    if (c) {
      await c.query(`DELETE FROM public.milestone_rewards WHERE milestone_id IN (101, 102)`);
      await c.query(`DELETE FROM public.activity_finalization_log WHERE activity_id = $1`, [SYN_ACTIVITY.id]);
      await c.query(`DELETE FROM public.user_inventory WHERE user_id = ANY($1::uuid[])`, [[USER_A, USER_B, USER_C]]);
      await c.query(`DELETE FROM public.users WHERE id = ANY($1::uuid[])`, [[USER_A, USER_B, USER_C]]);
      await c.query(`DELETE FROM public.activities WHERE id = $1`, [SYN_ACTIVITY.id]);
      await c.end();
    }
  } catch {/* ignore */}
  process.exit(1);
});