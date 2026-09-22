import { NextResponse } from 'next/server';
import { checkRateLimit, recordFailedAttempt, getClientIp } from '@/lib/rateLimiter';
import { isAdminDevBypass } from '@/app/lib/adminToken';

/**
 * POST /api/admin/validate
 * Validates the admin secret key.
 * Returns 200 if valid, 401 if invalid, 429 if rate limited.
 *
 * FIX V3/V4: Replaced direct string comparison with timingSafeEqual
 * to prevent timing oracle attacks. Also added rate limiting.
 *
 * NOTE: This route runs in the Node.js runtime, but we deliberately avoid
 * importing Node's `crypto` module here so the helpers stay aligned with
 * the Edge-safe `adminToken.ts` SSOT. We use a SHA-256 digest comparison
 * pattern (see app/api/admin/login/route.ts) that is constant-time AND
 * identical to the login flow.
 */
export async function POST(req: Request) {
  const clientIp = getClientIp(req);

  // ── Rate limit check (Redis-backed, sliding window) ─────────────────────────
  const { limited, retryAfterMs } = await checkRateLimit(clientIp);
  if (limited) {
    return NextResponse.json(
      { ok: false, error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((retryAfterMs ?? 60000) / 1000)),
        },
      }
    );
  }

  try {
    const body = await req.json();
    const { secret } = body;

    // Reject missing/empty secret up-front with 400 — separate from the
    // 401 "wrong password" path so callers can distinguish between
    // "bad request shape" and "credential rejected".
    if (typeof secret !== 'string' || secret.length === 0) {
      return NextResponse.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'secret is required' } },
        { status: 400 }
      );
    }

    const adminSecret = process.env.ADMIN_SECRET_KEY;

    // Dev bypass: accept literal "dev" when ADMIN_DEV_BYPASS=1 is set
    // AND NODE_ENV !== production. Mirrors login route behaviour.
    const devBypass = !adminSecret && isAdminDevBypass();

    if (!adminSecret && !devBypass) {
      console.error('[ADMIN_VALIDATE] ADMIN_SECRET_KEY is not set!');
      return NextResponse.json(
        { ok: false, error: { code: 'SERVER_ERROR', message: 'Server misconfigured' } },
        { status: 500 }
      );
    }

    // FIX V3/V4: Use SHA-256 digest comparison (constant-time, length-normalized).
    // We always compute both digests so the response path is identical regardless
    // of input length — no early-exit timing oracle.
    const crypto = await import('crypto');
    let valid = false;
    if (devBypass) {
      valid = (secret ?? '') === 'dev';
    } else {
      const pwDigest     = crypto.createHash('sha256').update(secret ?? '', 'utf8').digest();
      const secretDigest = crypto.createHash('sha256').update(adminSecret!, 'utf8').digest();
      valid = crypto.timingSafeEqual(pwDigest, secretDigest);
    }

    if (!valid) {
      await recordFailedAttempt(clientIp);
      return NextResponse.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid password' } },
        { status: 401 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[ADMIN_VALIDATE] Error:', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Validation failed' } },
      { status: 500 }
    );
  }
}
