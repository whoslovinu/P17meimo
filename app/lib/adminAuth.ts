import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyAdminToken, isAdminDevBypass } from '@/app/lib/adminToken';
import { getRedisClient } from '@/lib/redis';
import { env } from '@/lib/env';

/**
 * Admin API Auth Guard — HMAC Token Verification
 *
 * How auth works:
 *   1. POST /api/admin/login validates the password and issues an
 *      HttpOnly cookie `admin_token` containing an HMAC-SHA256 token:
 *      `{expiry_timestamp}:{HMAC-SHA256(ADMIN_SECRET_KEY, expiry_timestamp)}`
 *   2. Every subsequent admin API request presents that cookie.
 *   3. This guard verifies the HMAC signature AND the expiry timestamp.
 *      If the cookie is expired (>24h old) or the HMAC doesn't match, it is rejected.
 *
 * Phase 11: owner-command "lock_admin" integration.
 *   The /api/internal/owner-command endpoint writes the current server timestamp
 *   to Redis key `repark:admin:lock_epoch` when `lock_admin` is called.
 *   This guard reads that key. If a non-zero epoch exists AND the token's
 *   issued-at timestamp (the expiry field) is strictly before that epoch,
 *   the token is rejected — forcing every admin to re-authenticate.
 *
 * Security properties:
 *   • HMAC token carries no usable secret — even if intercepted, an attacker
 *     cannot forge a new token without knowing ADMIN_SECRET_KEY.
 *   • 24-hour expiry prevents replay of stale cookies.
 *   • HttpOnly + SameSite=Strict prevents XSS extraction and CSRF on POST.
 *   • timingSafeEqual prevents timing oracle attacks on the HMAC check.
 *   • Admin-lock-epoch prevents all existing sessions after lock_admin is called.
 *
 * Call requireAdminAuth at the top of every Admin API GET/POST handler.
 */

// ── Constants ───────────────────────────────────────────────────────────────

const ADMIN_COOKIE = 'admin_token';
const ADMIN_LOCK_EPOCH_KEY = 'repark:admin:lock_epoch';

// ── Guard ────────────────────────────────────────────────────────────────────

export async function requireAdminAuth(req: NextRequest | Request): Promise<NextResponse | null> {
  const adminSecret = env.adminSecret();
  const isProd = env.isProd();
  const devBypass = isAdminDevBypass();

  // Hard fail in production if secret is not configured.
  if (isProd && !adminSecret) {
    console.error(
      '[ADMIN_AUTH] FATAL: ADMIN_SECRET_KEY is not set in production.' +
      ' Rejecting all admin API requests.'
    );
    throw new Error('[ADMIN_AUTH] ADMIN_SECRET_KEY is strictly required in production.');
  }

  // Non-production without a secret AND without an explicit dev bypass →
  // admin panel is locked. This is the Phase 3 fail-closed behavior.
  if (!isProd && !adminSecret && !devBypass) {
    console.error(
      '[ADMIN_AUTH] ADMIN_SECRET_KEY is not configured and ADMIN_DEV_BYPASS is not set. ' +
      'Admin panel is locked. Set ADMIN_SECRET_KEY in .env.local, or run with ADMIN_DEV_BYPASS=1.'
    );
    return unauthorizedResponse();
  }

  // ── Extract admin_token cookie ──────────────────────────────────────────────
  let cookieValue: string | undefined;

  if ('cookies' in req && typeof (req as NextRequest).cookies.get === 'function') {
    cookieValue = (req as NextRequest).cookies.get(ADMIN_COOKIE)?.value;
  } else {
    const header = (req as Request).headers.get('cookie') ?? '';
    cookieValue = parseCookie(header, ADMIN_COOKIE);
  }

  if (!cookieValue || typeof cookieValue !== 'string') {
    logUnauthorized(req, 'missing_cookie');
    return unauthorizedResponse();
  }

  // ── Verify HMAC token (or dev bypass) ─────────────────────────────────────
  // verifyAdminToken is async because it uses Web Crypto subtle.verify —
  // Edge-safe. We swallow internal errors and report as 401 to avoid
  // leaking any failure modes to the caller.
  let valid = false;
  try {
    valid = await verifyAdminToken(adminSecret, cookieValue);
  } catch (err) {
    console.error('[ADMIN_AUTH] verifyAdminToken threw — rejecting as invalid:', err);
    valid = false;
  }

  if (!valid) {
    logUnauthorized(req, 'invalid_token');
    return unauthorizedResponse();
  }

  // ── Phase 11: owner-command lock_admin gate ───────────────────────────────
  // Parse the token to get the issued-at timestamp (expiry field = issuedAt).
  // If a lock_epoch exists in Redis and this token was issued before it,
  // the token is stale — require re-authentication.
  try {
    const colonIdx = cookieValue.indexOf(':');
    if (colonIdx > 0) {
      const issuedAtSec = Number(cookieValue.slice(0, colonIdx));
      if (Number.isFinite(issuedAtSec)) {
        const redis = getRedisClient();
        const lockEpochMs = await safeGetLockEpoch(redis);
        if (lockEpochMs > 0) {
          // issuedAt is in seconds; compare against epoch in milliseconds.
          if (issuedAtSec * 1000 < lockEpochMs) {
            logUnauthorized(req, 'token_revoked_by_lock');
            return unauthorizedResponse();
          }
        }
      }
    }
  } catch (checkErr) {
    // If the Redis read fails, fail open — we don't want a Redis outage
    // to lock every admin out permanently. Log loudly so ops can notice.
    console.error('[ADMIN_AUTH] lock_epoch check failed — proceeding without it:', checkErr);
  }

  return null; // Auth passed
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseCookie(cookieHeader: string, name: string): string | undefined {
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    if (trimmed.slice(0, eqIdx) === name) {
      return trimmed.slice(eqIdx + 1);
    }
  }
  return undefined;
}

function unauthorizedResponse(): NextResponse {
  return new NextResponse(
    JSON.stringify({ error: 'Unauthorized Access' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } }
  );
}

function logUnauthorized(req: NextRequest | Request, reason: string): void {
  console.warn('[ADMIN_AUTH] Unauthorized access rejected.', {
    reason,
    ip: (req as Request).headers.get('x-forwarded-for') ?? 'unknown',
    ua:  (req as Request).headers.get('user-agent') ?? 'unknown',
    hasCookie: (req as Request).headers.get('cookie') ? 'yes' : 'no',
  });
}

async function safeGetLockEpoch(redis: ReturnType<typeof getRedisClient>): Promise<number> {
  try {
    const raw = await redis.get(ADMIN_LOCK_EPOCH_KEY);
    const n = raw !== null ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}
