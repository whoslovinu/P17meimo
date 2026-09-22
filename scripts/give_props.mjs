#!/usr/bin/env node
/**
 * scripts/give_props.mjs — Top up a user's item_hand + item_phallus counts.
 *
 * Uses POST /api/admin/user/inventory (admin auth required) which sets BOTH
 * counts to the given absolute value. No daily-limit CHECK applies because
 * this is a direct admin-level grant, not an auto-grant from a task.
 *
 * Usage:
 *   node scripts/give_props.mjs <userId> <amount>
 *
 * Example (give 300 of each):
 *   node scripts/give_props.mjs 11111111-2222-4333-4444-555555555555 300
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

async function setInventory(cookie, userId, hand, phallus) {
  const res = await fetch(`${BASE}/api/admin/user/inventory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ userId, item_hand_count: hand, item_phallus_count: phallus }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`inventory ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function main() {
  const [, , userId, rawAmount] = process.argv;
  if (!userId || !rawAmount) {
    console.error('Usage: node scripts/give_props.mjs <userId> <amount>');
    process.exit(1);
  }
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(amount)) {
    console.error(`Invalid amount (must be non-negative integer): ${rawAmount}`);
    process.exit(1);
  }

  console.log(`[give_props] user=${userId} → hand=${amount} phallus=${amount}`);
  const cookie = await loginAdmin();
  console.log('[give_props] admin login ✓');

  const result = await setInventory(cookie, userId, amount, amount);
  console.log('[give_props] ✓ updated:', JSON.stringify(result));
  console.log(`→ Refresh /battle in your browser — 闪电符文 should now show ${amount}, 潮汐晶石 should show ${amount}.`);
}

main().catch((e) => { console.error('[give_props] failed:', e); process.exit(1); });