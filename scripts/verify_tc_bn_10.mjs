#!/usr/bin/env node
/**
 * scripts/verify_tc_bn_10.mjs — Formal TC-BN-10 verification.
 *
 * TC-BN-10: After claiming every claimable milestone for a user, the home
 * banner "可领取" badge AND the bottom TabBar "首页" red dot must both
 * disappear on next page refresh.
 *
 * Steps performed (all via real HTTP + cookies):
 *  1. RESET   — delete this user's damage_log rows AND milestone_claims rows
 *               via /api/admin/sql (admin cookie). Starts from a clean slate.
 *  2. SEED    — push enough damage so the FIRST milestone is reached.
 *  3. ASSERT  — /api/user/status returns has_unclaimed_milestone = true.
 *  4. CLAIM   — POST /api/claim for milestone #1, twice if you want to push
 *               past first threshold into second, etc.
 *  5. ASSERT  — has_unclaimed_milestone flips back to false once every
 *               reached milestone is claimed.
 *  6. PRINT   — summarize for review.
 *
 * Usage:
 *   node scripts/verify_tc_bn_10.mjs <userId>
 *
 * ─── REPARK 7.0 (2026-08-24) SCOPE NOTE ────────────────────────────────────
 * This TC script reads `/api/game/init` (legacy route alias kept for back-
 * compat) to inspect milestones. The active route is `/api/battle/init`
 * and its `personal_damage` field is now ACTIVITY-SCOPED (sourced from
 * `user_activity_stats.total_damage`), not `user_inventory.total_damage_dealt`.
 * The script's read-only contract is unchanged — it just inspects whatever
 * the active route returns. No code change required; document-only note.
 * ──────────────────────────────────────────────────────────────────────────
 */

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

async function loginAdmin() {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_SECRET_KEY ?? 'dev' }),
  });
  if (!res.ok) throw new Error(`admin/login ${res.status}: ${await res.text()}`);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const m = setCookie.match(/admin_token=([^;]+)/);
  if (!m) throw new Error(`admin_token cookie missing in: ${setCookie}`);
  return `admin_token=${m[1]}`;
}

async function adminSql(cookie, sql) {
  // Routes that accept raw SQL don't exist in this project — only surgical
  // RPC endpoints do. Throw a clear error if anything tries to use this.
  throw new Error('adminSql not available in this build. Use surgical admin routes instead.');
}

async function getStatus(userId) {
  const res = await fetch(`${BASE}/api/user/status?userId=${userId}`);
  const body = await res.json();
  return body?.data ?? {};
}

async function getMilestones() {
  const res = await fetch(`${BASE}/api/game/init`);
  const body = await res.json();
  const list = body?.data?.milestones ?? [];
  return list
    .map((m) => ({
      id: String(m.id),
      threshold: Number(m.threshold) || 0,
      reward: m.reward ?? null,
    }))
    .filter((m) => m.threshold > 0)
    .sort((a, b) => a.threshold - b.threshold);
}

async function seedDamage(cookie, userId, damage) {
  const res = await fetch(`${BASE}/api/test/seed-damage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ userId, damage }),
  });
  if (!res.ok) throw new Error(`seed-damage ${res.status}: ${await res.text()}`);
  return res.json();
}

async function claimMilestone(userId, milestoneId) {
  const res = await fetch(`${BASE}/api/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, milestoneId }),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
}

async function main() {
  const [, , userId] = process.argv;
  if (!userId) {
    console.error('Usage: node scripts/verify_tc_bn_10.mjs <userId>');
    process.exit(1);
  }

  console.log('━'.repeat(64));
  console.log(` TC-BN-10 verification for user: ${userId}`);
  console.log('━'.repeat(64));

  const cookie = await loginAdmin();
  console.log('[1] Admin login ✓');

  console.log('[2] Reading milestone table …');
  const milestones = await getMilestones();
  console.log(`    ${milestones.length} milestones configured:`,
    milestones.map((m) => `#${m.id}=${m.threshold}`).join(', '));

  // We push damage just past the LAST milestone so every milestone is
  // claimable. Otherwise the test would need 7 round-trips.
  const targetDamage = milestones[milestones.length - 1].threshold + 200;

  console.log(`[3] RESET — wiping damage_log + milestone_claims for ${userId}`);
  await adminSql(cookie, `DELETE FROM damage_log WHERE user_id='${userId}'`);
  await adminSql(cookie, `DELETE FROM milestone_claims WHERE user_id='${userId}'`);
  console.log('    ✓ reset done');

  console.log(`[4] SEED — damage → ${targetDamage}`);
  await seedDamage(cookie, userId, targetDamage);

  console.log('[5] STATUS BEFORE CLAIM');
  const before = await getStatus(userId);
  console.log('   ', {
    total_damage: before.total_damage,
    has_unclaimed_milestone: before.has_unclaimed_milestone,
  });
  if (!before.has_unclaimed_milestone) {
    throw new Error('Expected has_unclaimed_milestone=true after seed');
  }
  console.log('   ✓ badge condition met (would render on home page)');

  console.log('[6] CLAIM every milestone in order …');
  for (const m of milestones) {
    const r = await claimMilestone(userId, m.id);
    console.log(`    milestone ${m.id} (≥${m.threshold}): HTTP ${r.status}`);
    if (!r.ok) console.log(`      body: ${r.body}`);
  }

  console.log('[7] STATUS AFTER ALL CLAIMS');
  const after = await getStatus(userId);
  console.log('   ', {
    total_damage: after.total_damage,
    has_unclaimed_milestone: after.has_unclaimed_milestone,
  });

  console.log('━'.repeat(64));
  if (after.has_unclaimed_milestone === false) {
    console.log(' ✅ TC-BN-10 PASSED — badge will disappear on home page refresh.');
  } else {
    console.log(' ❌ TC-BN-10 FAILED — has_unclaimed_milestone still true.');
  }
  console.log('━'.repeat(64));

  console.log('\n→ Now refresh http://localhost:3000/ in your browser to visually confirm.');
  console.log('  Expected: no "可领取" badge, no red dot on bottom TabBar "首页" tab.');
}

main().catch((err) => {
  console.error('[verify_tc_bn_10] failed:', err);
  process.exit(1);
});