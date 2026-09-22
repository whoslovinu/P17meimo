/**
 * POST /api/mock/activity-reward
 *
 * Local development / test mock for the customer energy-reward webhook.
 * Replicates the Main Station's /api/webhook/activity/reward endpoint:
 *   - Validates HMAC-SHA256 signature (X-Webhook-Signature header)
 *   - Validates payload shape (action_type, amount, sign, timestamp, tx_id, user_id)
 *   - Returns { code: 200, data: true, message: '' }
 *
 * P0 2026-08-06 (TC-P0-26): Created to match "活动奖励回调接口 第三方对接文档 v1.0".
 *
 * NOTE: The real production URL is https://test.aidpzm.com/api/webhook/activity/reward.
 * This mock exists ONLY for local development / integration testing.
 */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

// In production the secret MUST come from WEBHOOK_SECRET (≥32 chars). When
// the variable is missing we refuse to verify any incoming request rather
// than fall back to a hard-coded test value, which would otherwise look
// like a working integration to a developer who forgot to configure env.
function requireMockWebhookSecret(): string {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      '[mock activity-reward] FATAL: WEBHOOK_SECRET is required (≥32 chars). ' +
      'Refusing to verify signatures with a missing or weak secret.'
    );
  }
  return secret;
}

interface RewardRequest {
  action_type: string;
  amount: number;
  sign: string;
  timestamp: number;
  tx_id: string;
  user_id: string;
}

function hmacSha256(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

export async function POST(req: Request) {
  // Read raw body for signature verification (must be byte-identical to what was signed)
  let rawBody = '';
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ code: 400, message: 'Failed to read body' }, { status: 400 });
  }

  // ── Signature verification ──────────────────────────────────────────────
  const headerSig = req.headers.get('x-webhook-signature') ?? '';
  const expectedHex = headerSig.startsWith('sha256=') ? headerSig.slice(7) : headerSig;
  let secret: string;
  try {
    secret = requireMockWebhookSecret();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    return NextResponse.json(
      { code: 500, message: 'Mock is not configured (missing WEBHOOK_SECRET).' },
      { status: 500 }
    );
  }
  const computed = hmacSha256(secret, rawBody);

  if (computed !== expectedHex) {
    console.warn('[Mock Activity Reward] Invalid signature:', {
      expected: computed.slice(0, 16) + '…',
      received: expectedHex.slice(0, 16) + '…',
    });
    return NextResponse.json(
      { code: 401, message: '签名验证失败' },
      { status: 200 }   // HTTP status always 200 per spec §5.1
    );
  }

  // ── Parse & validate payload ────────────────────────────────────────────
  let payload: Partial<RewardRequest>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ code: 500, message: 'Malformed JSON' }, { status: 200 });
  }

  // Destructuring with type assertion (fields are guaranteed present after parse)
  const p = payload as RewardRequest;

  if (typeof p.action_type !== 'string' || p.action_type !== 'reward') {
    return NextResponse.json({ code: 500, message: 'Invalid action_type' }, { status: 200 });
  }
  if (typeof p.amount !== 'number' || !Number.isInteger(p.amount) || p.amount <= 0) {
    return NextResponse.json({ code: 500, message: 'amount must be a positive integer' }, { status: 200 });
  }
  if (typeof p.sign !== 'string' || p.sign !== '0'.repeat(64)) {
    return NextResponse.json({ code: 500, message: 'Invalid sign placeholder' }, { status: 200 });
  }
  if (typeof p.tx_id !== 'string' || p.tx_id.length < 10) {
    return NextResponse.json({ code: 500, message: 'tx_id must be ≥ 10 characters' }, { status: 200 });
  }
  if (typeof p.timestamp !== 'number' || p.timestamp <= 0) {
    return NextResponse.json({ code: 500, message: 'timestamp must be a positive number' }, { status: 200 });
  }
  if (typeof p.user_id !== 'string' || !p.user_id) {
    return NextResponse.json({ code: 500, message: 'user_id is required' }, { status: 200 });
  }

  // ── Process the reward ────────────────────────────────────────────────
  console.log(
    `[Mock Activity Reward] ✅ Added ${p.amount} energy for user ${p.user_id}` +
    ` (tx=${p.tx_id}, ts=${p.timestamp})`
  );

  return NextResponse.json({ code: 200, data: true, message: '' }, { status: 200 });
}
