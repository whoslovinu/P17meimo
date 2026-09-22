/**
 * lib/services/badgeAdapter.ts
 *
 * Badge Adapter — outbound HTTP client for the Customer Badge Detail and Badge Grant APIs.
 *
 * Integrates with the existing Activity Reward architecture:
 *   - Reuses HMAC signing from lib/security/verifyWebhookSignature.ts (signWebhookPayload)
 *   - Reuses WEBHOOK_SECRET via requireWebhookSecret() from lib/security/verifyWebhookSignature.ts
 *   - Reuses HTTP client (fetch), timeout, retry, and error handling from outboundWebhook.ts
 *   - Reuses structured logging patterns
 *
 * Customer spec: "第三方活动勋章接口" (2026-09)
 *   - POST /webhook/activity/badge/detail  — get badge metadata
 *   - POST /webhook/activity/badge/grant   — grant badge to user
 *   - Auth: HMAC-SHA256 on raw body bytes, header: X-Webhook-Signature: sha256=<hex>
 *   - Same WEBHOOK_SECRET as energy webhook (shared secret with Main Station)
 *
 * No duplicated signing logic. No duplicated secret validation.
 *
 * Hardening 2026-09-11 (Commander Addendum):
 *   - request_id generated ONCE per logical grant, reused across retries
 *   - Endpoints are required env vars (no defaults) — fail-fast on init if missing
 *   - Error semantics match ENERGY: the adapter does NOT decide HTTP status;
 *     the caller (route layer) decides, identical to sendMainStationEnergyReward
 *   - Missing medalId at the call site is a CONFIG_ERROR (handled by the route)
 */

import crypto from 'node:crypto';

// ── Required env vars (fail-fast on init) ────────────────────────────────────

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `[BadgeAdapter] FATAL: environment variable ${name} is required. ` +
      `The badge adapter refuses to start without an explicit endpoint. ` +
      `Set ${name} to the customer Main Station badge URL before deploying.`
    );
  }
  return value.trim();
}

/**
 * Badge Detail API endpoint. REQUIRED env var.
 */
const BADGE_DETAIL_URL = requiredEnv('MAIN_STATION_BADGE_DETAIL_URL');

/**
 * Badge Grant API endpoint. REQUIRED env var.
 */
const BADGE_GRANT_URL = requiredEnv('MAIN_STATION_BADGE_GRANT_URL');

/**
 * Shared secret with Main Station — same WEBHOOK_SECRET as the energy webhook.
 * Imported from lib/security/verifyWebhookSignature.ts to avoid duplication.
 * The requireWebhookSecret() call validates length (≥32 chars in production)
 * before any signing operation.
 */
function getWebhookSecret(): string {
  // Dynamic require to avoid circular dependency at module load time.
  // Both modules are in lib/, so this is safe.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { requireWebhookSecret } = require('@/lib/security/verifyWebhookSignature');
  return requireWebhookSecret();
}

// ── Constants (aligned with outboundWebhook.ts) ────────────────────────────────

const REQUEST_TIMEOUT_MS = 10_000;  // 10 s per attempt
const MAX_RETRIES        = 3;
const RETRY_DELAY_MS     = 5_000;  // ≥ 5 s interval per spec

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * Response shape from GET /webhook/activity/badge/detail.
 * The `status` field is nullable per spec.
 */
export interface BadgeDetailResult {
  badge_id:     string;
  name:         string;
  icon:         string;     // URL; empty string if not set
  description:  string;    // empty string if not set
  status:       number | null; // 1=active, -1=offline, null=unset
}

/**
 * getBadgeDetail — result shape when the badge is found and active.
 */
export interface BadgeDetailSuccess {
  ok:   true;
  data: BadgeDetailResult;
}

/**
 * getBadgeDetail — result shape when the badge is not found or API fails.
 * Reason taxonomy mirrors grantBadge for caller consistency.
 */
export interface BadgeDetailFailure {
  ok: false;
  reason: 'NOT_FOUND' | 'INACTIVE' | 'API_ERROR' | 'NETWORK_ERROR' | 'AUTH_FAILED' | 'INVALID_PARAM';
  message: string;
}

/**
 * grantBadge — result shape when the grant succeeds.
 */
export interface BadgeGrantSuccess {
  ok: true;
  /** The stable request_id that was used across all retries. */
  requestId: string;
}

/**
 * grantBadge — result shape when the grant fails.
 * Reason taxonomy is internal — the route layer chooses the HTTP status.
 */
export interface BadgeGrantFailure {
  ok:    false;
  reason: 'USER_NOT_FOUND' | 'BADGE_NOT_FOUND' | 'INVALID_PARAM' | 'AUTH_FAILED' | 'API_ERROR' | 'NETWORK_ERROR';
  message: string;
}

/**
 * grantBadge — input parameters.
 * All string fields accept decimal numeric strings (e.g. "128") per spec.
 */
export interface BadgeGrantParams {
  /** Canonical UUID — used for tx_id composition and local logging only. */
  userId:     string;
  /** Raw user ID as accepted by the Main Station (e.g. "128"). */
  originalUserId: string;
  /** Badge ID — decimal numeric string from the activity milestone config (e.g. "10021"). */
  badgeId:    string;
  /** Activity ID from the activity milestone config. */
  activityId: string;
}

/**
 * Optional pre-generated request_id. If supplied, the adapter uses it verbatim
 * across all retries. If omitted, the adapter generates one stable id and
 * reuses it across all retries for the same logical grant.
 */
export interface BadgeGrantOptions {
  /** Stable request_id reused across retries. */
  requestId?: string;
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Build the HMAC-SHA256 body + signature header.
 *
 * Per spec: the raw UTF-8 body bytes are used both as the HMAC input
 * AND as the POST body — they must be byte-identical.
 * No compact-alpha-sort or field reordering. JSON is sent as-is.
 *
 * We delegate HMAC computation to signWebhookPayload so there is exactly
 * one place where HMAC-SHA256("sha256=", secret, body) is implemented.
 */
function signBody(body: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { signWebhookPayload } = require('@/lib/security/verifyWebhookSignature');
  return signWebhookPayload(body, getWebhookSecret());
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomRequestId(userId: string, badgeId: string, activityId: string): string {
  // crypto.randomUUID for the random tail — collision-free under retries.
  return `BADGE_GRANT_${userId}_${badgeId}_${activityId}_${crypto.randomUUID()}`;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * getBadgeDetail — fetch badge metadata from the Main Station Badge Detail API.
 *
 * Auth: HMAC-SHA256 over the raw body bytes (identical to energy webhook).
 * Non-2xx or non-200 code → failure.
 * 200 + data=null → treated as NOT_FOUND.
 * 200 + data.status !== 1 → treated as INACTIVE.
 *
 * No caching — callers handle caching if needed.
 *
 * @param badgeId  Decimal numeric string, e.g. "10021"
 * @returns BadgeDetailSuccess | BadgeDetailFailure
 */
export async function getBadgeDetail(badgeId: string): Promise<BadgeDetailSuccess | BadgeDetailFailure> {
  if (!badgeId || typeof badgeId !== 'string') {
    return { ok: false, reason: 'INVALID_PARAM', message: 'badge_id is required' };
  }

  const body = JSON.stringify({ badge_id: badgeId });
  const requestId = `BADGE_DETAIL_${badgeId}_${crypto.randomUUID()}`;

  console.log(`[BadgeAdapter] → POST ${BADGE_DETAIL_URL} badge_id=${badgeId}`);

  try {
    const response = await fetchWithRetry(BADGE_DETAIL_URL, {
      method: 'POST',
      headers: {
        'Content-Type':          'application/json; charset=utf-8',
        'X-Webhook-Signature':  signBody(body),
        'X-Request-Id':          requestId,
      },
      body,
    }, requestId);

    if (!response.ok) {
      return {
        ok: false,
        reason: 'API_ERROR',
        message: `HTTP ${response.status}`,
      };
    }

    const parsed = response.parsed as { code: number; data: BadgeDetailResult | null; message: string };

    if (parsed.code !== 200) {
      const reason = parsed.code === 401
        ? 'AUTH_FAILED'
        : 'API_ERROR';
      return {
        ok: false,
        reason,
        message: parsed.message ?? `code=${parsed.code}`,
      };
    }

    if (!parsed.data) {
      // { code: 200, data: null, message: "勋章不存在" }
      return {
        ok: false,
        reason: 'NOT_FOUND',
        message: parsed.message ?? '勋章不存在',
      };
    }

    // Per spec: status 1 = active, -1 = offline. Null is also treated as inactive.
    if (parsed.data.status !== 1) {
      return {
        ok: false,
        reason: 'INACTIVE',
        message: `勋章已下线 (status=${parsed.data.status})`,
      };
    }

    console.log(`[BadgeAdapter] ← badge_id=${parsed.data.badge_id} name=${parsed.data.name} status=${parsed.data.status}`);

    return { ok: true, data: parsed.data };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[BadgeAdapter] ❌ getBadgeDetail failed: ${msg}`);
    return { ok: false, reason: 'NETWORK_ERROR', message: msg };
  }
}

/**
 * grantBadge — issue a badge to a user via the Main Station Badge Grant API.
 *
 * Auth: HMAC-SHA256 over the raw body bytes (identical to energy webhook).
 * Per spec: duplicate grants are idempotent (INSERT IGNORE on Main Station side).
 *
 * Hardening 2026-09-11: a single stable request_id is generated per call and
 * reused across ALL retry attempts. The Main Station sees the same id no
 * matter how many times we retry.
 *
 * @returns BadgeGrantSuccess | BadgeGrantFailure
 */
export async function grantBadge(
  params: BadgeGrantParams,
  options: BadgeGrantOptions = {}
): Promise<BadgeGrantSuccess | BadgeGrantFailure> {
  const { userId, originalUserId, badgeId, activityId } = params;

  if (!userId || !originalUserId || !badgeId || !activityId) {
    return { ok: false, reason: 'INVALID_PARAM', message: 'user_id, badge_id, activity_id are required' };
  }

  // Stable request_id: generated ONCE and reused across retries.
  // The caller may pre-supply an id via options.requestId (rare, but supported).
  const requestId = options.requestId
    ?? randomRequestId(userId, badgeId, activityId);

  const bodyObj = {
    user_id:    String(originalUserId),
    badge_id:   String(badgeId),
    activity_id: String(activityId),
    request_id: requestId,
  };
  const body = JSON.stringify(bodyObj);

  console.log(`[BadgeAdapter] → POST ${BADGE_GRANT_URL}`);
  console.log(`[BadgeAdapter]   request_id=${requestId} user_id=${originalUserId} badge_id=${badgeId} activity_id=${activityId}`);

  try {
    const response = await fetchWithRetry(BADGE_GRANT_URL, {
      method: 'POST',
      headers: {
        'Content-Type':          'application/json; charset=utf-8',
        'X-Webhook-Signature':  signBody(body),
        'X-Request-Id':         requestId,
      },
      body,
    }, requestId);

    if (!response.ok) {
      // Non-2xx HTTP status — mirror ENERGY: surface the error and let the
      // caller (route layer) choose the HTTP status. We do NOT pick 502 here.
      return {
        ok: false,
        reason: 'API_ERROR',
        message: `HTTP ${response.status}`,
      };
    }

    const parsed = response.parsed as { code: number; data: unknown; message: string };

    if (parsed.code === 200) {
      console.log(`[BadgeAdapter] ← grant OK request_id=${requestId}`);
      return { ok: true, requestId };
    }

    // Map Main Station error codes to our reason taxonomy
    const reason = mapGrantErrorCode(parsed.code, parsed.message);
    console.warn(`[BadgeAdapter] ← grant failed code=${parsed.code} reason=${reason} message=${parsed.message}`);
    return { ok: false, reason, message: parsed.message ?? `code=${parsed.code}` };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[BadgeAdapter] ❌ grantBadge failed: ${msg}`);
    return { ok: false, reason: 'NETWORK_ERROR', message: msg };
  }
}

/**
 * Map Main Station HTTP-body `code` values to our grant failure reasons.
 *
 * 200 = success (handled before this function is called).
 * 401 = auth failure (bad secret / bad IP).
 * 500 = business logic failure.
 */
function mapGrantErrorCode(code: number, message: string): BadgeGrantFailure['reason'] {
  if (code === 401) return 'AUTH_FAILED';
  if (code === 500) {
    const lower = (message ?? '').toLowerCase();
    if (lower.includes('用户不存在') || lower.includes('user')) return 'USER_NOT_FOUND';
    if (lower.includes('勋章不存在') || lower.includes('badge')) return 'BADGE_NOT_FOUND';
    if (lower.includes('badge_id') || lower.includes('user_id') ||
        lower.includes('activity_id') || lower.includes('request_id') ||
        lower.includes('无效') || lower.includes('参数错误')) return 'INVALID_PARAM';
    return 'API_ERROR';
  }
  return 'API_ERROR';
}

// ── Shared retry logic ─────────────────────────────────────────────────────

interface FetchOptions extends RequestInit {
  signal?: AbortSignal;
}

function isRetryable(err: unknown): { retryable: boolean; message: string } {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    const isAbort  = msg.includes('aborted') || err.name === 'AbortError';
    const isNetwork =
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('etimedout') ||
      msg.includes('network') ||
      msg.includes('socket hang up') ||
      msg.includes('fetch failed');

    if (isAbort || isNetwork) {
      return { retryable: true, message: err.message };
    }
  }
  return { retryable: false, message: err instanceof Error ? err.message : String(err) };
}

/**
 * fetchWithRetry — shared retry wrapper for badge API calls.
 *
 * Retry policy (aligned with outboundWebhook.ts):
 *   - 520 or network error: retry up to MAX_RETRIES with ≥5 s interval
 *   - 401 or other non-520 errors: do NOT retry
 *
 * Hardening 2026-09-11: the caller passes a STABLE requestId so every retry
 * reuses the same X-Request-Id header. The body bytes never change across
 * retries (we re-serialise the SAME body), so the HMAC signature stays valid
 * for all attempts. This matches the Main Station's idempotency expectation.
 *
 * Returns { ok, status, parsed } on any HTTP status.
 * Throws only after all retries are exhausted.
 */
async function fetchWithRetry(
  url: string,
  options: FetchOptions,
  requestId: string
): Promise<{ ok: boolean; status: number; parsed: unknown }> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      // Re-build headers on every attempt so we log each retry clearly,
      // but the body and signature are IDENTICAL across attempts (requestId
      // is stable). HMAC stays valid; idempotency key stays the same.
      const headers = {
        ...(options.headers as Record<string, string>),
        'X-Request-Id': requestId,
      };

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal as never,
      });

      clearTimeout(timeout);

      // Always parse body; let callers interpret the payload.
      const text = await response.text();
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = { code: -1, message: text }; }

      // 520 = rate-limit → retryable
      const p = parsed as { code?: number };
      if (p?.code === 520) {
        const waitMs = RETRY_DELAY_MS * attempt;
        console.warn(`[BadgeAdapter]   ⚠️  code=520 rate-limit (request_id=${requestId}), retry #${attempt} in ${waitMs}ms…`);
        lastError = new Error(`Rate-limit code=520`);
        if (attempt < MAX_RETRIES) await sleep(waitMs);
        continue;
      }

      // Any other response (including non-2xx HTTP status) is returned as-is.
      return { ok: response.ok, status: response.status, parsed };

    } catch (err) {
      const { retryable, message } = isRetryable(err);
      if (retryable && attempt < MAX_RETRIES) {
        const waitMs = RETRY_DELAY_MS * attempt;
        console.warn(`[BadgeAdapter]   ⚠️  Network error (request_id=${requestId}), retry #${attempt} in ${waitMs}ms: ${message}`);
        lastError = err instanceof Error ? err : new Error(message);
        await sleep(waitMs);
        continue;
      }
      // Exhausted retries or non-retryable
      lastError = err instanceof Error ? err : new Error(message);
      break;
    }
  }

  const msg = lastError?.message ?? 'Unknown error';
  throw new Error(`BadgeAdapter fetch failed after ${MAX_RETRIES} attempts: ${msg}`);
}
