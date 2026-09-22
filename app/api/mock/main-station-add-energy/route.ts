/**
 * POST /api/mock/main-station-add-energy
 *
 * Local development / test mock that replicates the Main Station's
 * energy-add endpoint signature and response surface.
 *
 * P0 2026-08-04: Created for TC-P0-24 outbound webhook milestone callbacks.
 *                 To be used ONLY in dev/test environments.
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
      '[mock main-station-add-energy] FATAL: WEBHOOK_SECRET is required (≥32 chars). ' +
      'Refusing to verify signatures with a missing or weak secret.'
    );
  }
  return secret;
}

interface AddEnergyRequest {
  user_id: string;
  reward_type: string;
  amount: number;
  milestone_id: string | number;
  tx_id: string;
  timestamp: number;
  sign: string;
}

function hmacSha256(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

export async function POST(req: Request) {
  let body: Partial<AddEnergyRequest> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: 400, message: 'Malformed JSON' }, { status: 400 });
  }

  // ── Signature verification ──────────────────────────────────────────────
  const rawBody = JSON.stringify(body);
  const expectedHeaderSig = req.headers.get('x-webhook-signature') ?? '';
  const expectedHex = expectedHeaderSig.startsWith('sha256=')
    ? expectedHeaderSig.slice(7)
    : expectedHeaderSig;

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
  const sigValid = computed === expectedHex;

  if (!sigValid) {
    console.warn('[Mock MainStation] Invalid signature:', {
      expected: computed.slice(0, 16) + '…',
      received: expectedHex.slice(0, 16) + '…',
    });
    return NextResponse.json(
      { code: 401, message: 'Invalid webhook signature' },
      { status: 401 }
    );
  }

  // ── Process the add-energy request ───────────────────────────────────────
  const { user_id, amount, milestone_id, tx_id } = body;

  console.log(
    `[Mock Main Station] Successfully added ${amount} energy for user ${user_id}` +
    ` (milestone=${milestone_id}, tx=${tx_id})`
  );

  return NextResponse.json({ code: 200, message: 'success' }, { status: 200 });
}
