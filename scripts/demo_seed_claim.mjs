#!/usr/bin/env node
/**
 * scripts/demo_seed_claim.mjs — Demo helper for the customer review meeting.
 *
 * Promotes a specific userId so the "可领取" badge lights up on the home
 * banner carousel (TC-BN-02).  Pick a user_id (e.g. the one in your app
 * localStorage), run this, refresh the home page, and the badge appears.
 *
 * Usage:
 *   node scripts/demo_seed_claim.mjs <userId> <damage>
 *
 * Example:
 *   node scripts/demo_seed_claim.mjs 11111111-2222-4333-8444-555555555555 25050
 *
 * Requires ADMIN_DEV_BYPASS=1 + ADMIN_SECRET_KEY=dev (default in .env.local)
 * so /api/test/seed-damage accepts the request.
 *
 * ─── REPARK 7.0 (2026-08-24) SCOPE NOTE ────────────────────────────────────
 * This helper seeds user_inventory.total_damage_dealt via the legacy dev
 * /api/test/seed-damage endpoint. Since the Activity Personal Damage
 * migration, milestone unlock thresholds use user_activity_stats.total_damage
 * (scoped to the current active activity), NOT this global field. Therefore
 * this script alone will NOT light up the "可领取" badge for milestones that
 * depend on the activity-scoped counter — the activity-scoped UPSERT only
 * happens via /api/action/attack. This script remains useful for global
 * KPI / leaderboard demos. For milestone demos, run a few real attacks
 * first. No code change required here; document-only clarification.
 * ──────────────────────────────────────────────────────────────────────────
 */

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

async function getAdminCookie() {
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

async function getFirstMilestone() {
  const res = await fetch(`${BASE}/api/game/init`);
  const body = await res.json();
  const milestones = body?.data?.milestones ?? [];
  if (milestones.length === 0) throw new Error('No milestones configured for the active activity');
  const sorted = milestones
    .map((m) => Number(m.threshold) || 0)
    .filter((t) => t > 0)
    .sort((a, b) => a - b);
  return sorted[0];
}

async function main() {
  const [, , userId, rawDamage] = process.argv;
  if (!userId) {
    console.error('Usage: node scripts/demo_seed_claim.mjs <userId> [damage]');
    console.error('  damage defaults to first milestone threshold + 100');
    process.exit(1);
  }
  const damage = Number(rawDamage) || (await getFirstMilestone()) + 100;

  console.log(`[demo] Logging in as admin …`);
  const cookie = await getAdminCookie();

  console.log(`[demo] Seeding ${damage} damage for ${userId} …`);
  const seedRes = await fetch(`${BASE}/api/test/seed-damage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ userId, damage }),
  });
  if (!seedRes.ok) {
    console.error(`[demo] seed-damage ${seedRes.status}: ${await seedRes.text()}`);
    process.exit(1);
  }
  const seedBody = await seedRes.json();
  console.log(`[demo] Seeded:`, seedBody.data);

  console.log(`[demo] Verifying has_unclaimed_milestone …`);
  const verifyRes = await fetch(`${BASE}/api/user/status?userId=${userId}`);
  const verifyBody = await verifyRes.json();
  console.log(`[demo] Status:`, {
    total_damage: verifyBody?.data?.total_damage,
    has_unclaimed_milestone: verifyBody?.data?.has_unclaimed_milestone,
  });

  if (verifyBody?.data?.has_unclaimed_milestone) {
    console.log('\n[demo] ✓ "可领取" badge will appear on home banner for this user.');
    console.log(`[demo] Open http://localhost:3000/ with cookie uid=${userId} to see it.`);
  } else {
    console.warn('\n[demo] ✗ Badge will NOT appear — damage below the first threshold?');
  }
}

main().catch((err) => {
  console.error('[demo] failed:', err);
  process.exit(1);
});