/**
 * lib/services/outboundWebhook.ts
 *
 * Outbound HTTP webhook sender: H5 → Main Station energy reward callbacks.
 *
 * P0 2026-08-06 (TC-P0-26): Adapted to official customer spec
 * "活动奖励回调接口 — 第三方对接文档 v1.0".
 *
 * Key spec requirements:
 *   - URL       : https://test.aidpzm.com/api/webhook/activity/reward
 *                 (overridable via MAIN_STATION_ADD_ENERGY_URL env var)
 *   - Secret    : WEBHOOK_SECRET (same as /api/webhook/user-action)
 *   - Body      : alpha-sorted compact JSON
 *                 { action_type, amount, sign: 64×'0', timestamp, tx_id, user_id }
 *                 The same string is used for HMAC input AND as the POST body.
 *   - HMAC      : SHA256, single-pass, header: X-Webhook-Signature: sha256=<hex>
 *   - X-Request-Id: tx_id
 *   - Response  : HTTP status is always 200; success is body.code === 200.
 *                 code=520 is retryable (rate-limit); 401 must NOT retry.
 *   - Retry     : up to 3 times with ≥5 s interval.
 *   - Timeout   : 10 s per attempt.
 */

import crypto from 'node:crypto';

// ── Env ────────────────────────────────────────────────────────────────────

const MAIN_STATION_URL =
  process.env.MAIN_STATION_ADD_ENERGY_URL ??
    'https://your-main-station.example.com/api/webhook/activity/reward';

// WEBHOOK_SECRET is required for outbound signing.
// We refuse to send any request (even a placeholder-signed one) when the
// secret is missing — silently falling back to a hard-coded default would
// leak the wrong signature to the Main Station and look like a successful
// callback when the customer has not configured the integration yet.
function requireWebhookSecret(): string {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      '[outboundWebhook] FATAL: WEBHOOK_SECRET is required (≥32 chars). ' +
      'Refusing to send Main Station callbacks with a missing or weak secret.'
    );
  }
  return secret;
}

const REQUEST_TIMEOUT_MS  = 10_000;   // 10 s per attempt (customer spec §3.1)
const MAX_RETRIES         = 3;
const RETRY_DELAY_MS      = 5_000;     // ≥ 5 s (customer spec §6.3)

// ── Types ───────────────────────────────────────────────────────────────────

export interface EnergyRewardPayload {
  action_type: 'reward';
  amount: number;          // positive integer energy units (not 分)
  sign: string;            // 64 × '0' (placeholder; not HMAC)
  timestamp: number;       // Unix ms
  tx_id: string;           // ≥ 10 chars, globally unique
  user_id: string;         // string, must match Main Station user_id
}

export interface MainStationCallbackResult {
  ok: boolean;
  code: number;
  body: unknown;
}

// ── Internal helpers ────────────────────────────────────────────────────────

function hmacSha256(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

/**
 * Build the HMAC-signed body per customer spec §4.1–4.2.
 *
 * The alpha-sorted compact JSON string (with sign=64×'0') is used BOTH
 * as the HMAC input AND as the POST body — they must be byte-identical.
 */
function buildSignedBody(params: {
  userId: string;
  amount: number;
  txId: string;
}): { body: string; headerSig: string } {
  const SIGN_PLACEHOLDER = '0'.repeat(64);
  const timestamp = Date.now();

  // Alpha-sorted keys: action_type → amount → sign → timestamp → tx_id → user_id
  const payloadObj: EnergyRewardPayload = {
    action_type: 'reward',
    amount: Math.floor(params.amount),   // ensure integer
    sign: SIGN_PLACEHOLDER,
    timestamp,
    tx_id: params.txId,
    user_id: String(params.userId),
  };

  // Compact JSON — no spaces, no newlines, keys in alpha order
  const body = JSON.stringify(payloadObj);

  // Single-pass HMAC-SHA256 (per customer spec §4.2)
  // Resolve the secret at call time so test/prod never share a default.
  const secret = requireWebhookSecret();
  const signature = hmacSha256(secret, body);

  return { body, headerSig: signature };
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * sendMainStationEnergyReward
 *
 * Fires an HMAC-signed POST to the Main Station's reward endpoint.
 *
 * Retry policy (per customer spec §6.3):
 *   - 520 (rate-limit): retry up to 3 times with ≥5 s between attempts.
 *   - Network/timeout  : retry up to 3 times.
 *   - 401 / other non-520 errors: do NOT retry.
 *
 * @throws if all attempts fail (or on non-retryable errors).
 *          Callers MUST NOT mark the DB row as claimed when this throws —
 *          this guarantees DB and Main Station stay in sync.
 */
export async function sendMainStationEnergyReward(params: {
  userId: string;            // canonical UUID (used for DB ops / tx_id composition)
  originalUserId: string;    // raw long ID or whatever the Main Station accepts (used in body.user_id)
  amount: number;          // e.g. 500 | 1000 | 2000
  milestoneId: string | number;
}): Promise<MainStationCallbackResult> {
  const { userId, originalUserId, amount, milestoneId } = params;
  // tx_id uses the canonical UUID for uniqueness in our system
  const txId = `MS_REWARD_${userId}_${milestoneId}_${Date.now()}`;

  console.log(`[OutboundWebhook] → POST ${MAIN_STATION_URL}`);
  console.log(`[OutboundWebhook]   tx_id=${txId} user_id=${originalUserId} (canonical=${userId}) amount=${amount}`);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { body, headerSig } = buildSignedBody({ userId: originalUserId, amount, txId });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(MAIN_STATION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${headerSig}`,
          'X-Request-Id': txId,
        },
        body,
        signal: controller.signal as never,
      });

      clearTimeout(timeout);

      // Parse response body — HTTP status is always 200 per spec §5.1
      const text = await response.text();
      let parsed: { code: number; message: string; data?: unknown };
      try { parsed = JSON.parse(text); } catch { parsed = { code: -1, message: text }; }

      console.log(`[OutboundWebhook]   ← HTTP ${response.status} code=${parsed.code} "${parsed.message}"`);

      if (parsed.code === 200) {
        return { ok: true, code: 200, body: parsed };
      }

      if (parsed.code === 520) {
        // Rate-limited — retryable
        const waitMs = RETRY_DELAY_MS * attempt;
        console.warn(`[OutboundWebhook]   ⚠️  code=520 rate-limit, retry #${attempt} in ${waitMs}ms…`);
        lastError = new Error(`Main Station rate-limit (code=520): ${parsed.message}`);
        if (attempt < MAX_RETRIES) await sleep(waitMs);
        continue;
      }

      // 401 / 500 / other — non-retryable
      throw new Error(`Main station reward error [${parsed.code}]: ${parsed.message}`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // Distinguish timeout / network error (retryable) from logic error
      const isNetworkError =
        msg.includes('aborted') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ENOTFOUND') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('network') ||
        err instanceof Error && err.name === 'AbortError';

      if (isNetworkError && attempt < MAX_RETRIES) {
        const waitMs = RETRY_DELAY_MS * attempt;
        console.warn(`[OutboundWebhook]   ⚠️  Network error, retry #${attempt} in ${waitMs}ms: ${msg}`);
        lastError = new Error(`Network error: ${msg}`);
        await sleep(waitMs);
        continue;
      }

      // Exhausted retries or non-retryable error
      console.error(`[OutboundWebhook] ❌ Callback failed (attempt ${attempt}/${MAX_RETRIES}): ${msg}`);
      lastError = err instanceof Error ? err : new Error(msg);
      break;
    }
  }

  // All retries exhausted
  const finalMsg = lastError?.message ?? 'Unknown error';
  console.error(`[OutboundWebhook] ❌ All ${MAX_RETRIES} attempts failed: ${finalMsg}`);
  throw new Error(`Outbound webhook failed after ${MAX_RETRIES} attempts: ${finalMsg}`);
}
