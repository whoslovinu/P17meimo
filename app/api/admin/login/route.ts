import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { buildAdminToken, isAdminDevBypass } from '@/app/lib/adminToken';
import { checkRateLimit, recordFailedAttempt, clearRateLimit, getClientIp } from '@/lib/rateLimiter';
import { getCustomAdminPasswordHash } from '@/lib/db/adminPassword';

/**
 * POST /api/admin/login
 *
 * Authenticates admin via password, then sets an HttpOnly, Secure,
 * SameSite=Strict cookie named `admin_token`.
 *
 * The cookie value is an HMAC-SHA256 token of the form:
 *   `{expiry_timestamp}:{HMAC-SHA256(ADMIN_SECRET_KEY, expiry_timestamp)}`
 *
 * Rate limiting:
 *   - 5 attempts per minute per IP
 *   - Returns 429 Too Many Requests when exceeded
 *
 * Security properties:
 *   1. Constant-time rate limit check (no timing oracle)
 *   2. Timing-safe password comparison (no timing oracle)
 *   3. No fallback passwords (production crash instead of silent dev fallback)
 *   4. HMAC token expiry: prevents replay after 24h
 *   5. HttpOnly + SameSite=Strict: not readable by JS, not sent on cross-site POST
 */

// ── Request Schema (Zod shield — strict payload validation) ─────────────────

const LoginRequestSchema = z.object({
  password: z.string().min(1, '密码不能为空'),
});

// ── Constants ───────────────────────────────────────────────────────────────

const ADMIN_COOKIE = 'admin_token';

// ── Handler ─────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const clientIp = getClientIp(req);

  // ── Rate limit check (Redis-backed, sliding window) ─────────────────────────
  const { limited, retryAfterMs } = await checkRateLimit(clientIp);
  if (limited) {
    return NextResponse.json(
      { ok: false, error: '请求过于频繁，请稍后再试' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((retryAfterMs ?? WINDOW_MS) / 1000)),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Date.now() + (retryAfterMs ?? WINDOW_MS)),
        },
      }
    );
  }

  try {
    // ── 1. Parse + validate request body via Zod ────────────────────────────
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Malformed JSON body' },
        { status: 400 }
      );
    }

    const parsed = LoginRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: '密码不能为空' },
        { status: 400 }
      );
    }
    const { password } = parsed.data;

    // ── 2. Resolve the active password (DUAL-TRACK) ─────────────────────────
    //
    //   Track A: Custom hash stored in PostgreSQL repark_config (Redis-cached).
    //            When present, this OVERRIDES the env secret for *login* only.
    //   Track B: process.env.ADMIN_SECRET_KEY — unchanged HMAC signing key.
    //
    // The HMAC secret (Track B) is NEVER swapped by the password change flow,
    // so existing admin_token cookies remain valid until natural 24h expiry.
    const crypto = await import('crypto');
    const customEntry = await getCustomAdminPasswordHash().catch((err) => {
      console.error('[ADMIN_LOGIN] getCustomAdminPasswordHash failed:', err);
      return null;
    });

    // Load env fallback only if a custom hash exists (HMAC signing still needs it).
    const adminSecret = process.env.ADMIN_SECRET_KEY;
    const devBypass = !adminSecret && isAdminDevBypass();

    if (!adminSecret && !devBypass) {
      console.error(
        '[ADMIN_LOGIN] FATAL: ADMIN_SECRET_KEY is not set in environment.' +
        ' Admin panel is inaccessible. Set ADMIN_SECRET_KEY in .env.local or platform env vars.'
      );
      return NextResponse.json(
        { ok: false, error: 'Server misconfiguration: ADMIN_SECRET_KEY is not set' },
        { status: 500 }
      );
    }

    // ── 3. Constant-time password comparison (DUAL-TRACK, no timing oracle) ─
    //
    // Always compute BOTH digests so the response path is identical regardless
    // of which track is active — no early-exit timing oracle.
    //
    // Dev bypass short-circuits the HMAC check — the dev password is the
    // literal string "dev" and the cookie returned is the static bypass
    // token. This branch is unreachable in production.
    const pwDigest = crypto.createHash('sha256').update(password, 'utf8').digest();

    let match = false;
    if (devBypass) {
      match = password === 'dev';
    } else if (customEntry) {
      // Track A: compare against the stored custom hash (lowercase hex).
      const customDigest = Buffer.from(customEntry.hash, 'hex');
      match =
        customDigest.length === pwDigest.length &&
        timingSafeEqual(customDigest, pwDigest);
    } else {
      // Track B: compare against the env-stored admin secret.
      const secretDigest = crypto.createHash('sha256').update(adminSecret!, 'utf8').digest();
      match = timingSafeEqual(pwDigest, secretDigest);
    }

    if (!match) {
      // Record failed attempt for rate limiting
      await recordFailedAttempt(clientIp);

      console.warn('[ADMIN_LOGIN] Invalid password attempt.', {
        ip: clientIp,
        ua: req.headers.get('user-agent') ?? 'unknown',
      });
      // Always return the same 401 response to prevent username enumeration.
      return NextResponse.json(
        { ok: false, error: '密码错误' },
        { status: 401 }
      );
    }

    // ── 4. Issue HMAC-signed token cookie ───────────────────────────────────
    // buildAdminToken is async because Web Crypto subtle.sign is async (Edge-safe).
    const token       = await buildAdminToken(adminSecret);
    const cookieStore = await cookies();

    // Clear rate limit on successful login
    await clearRateLimit(clientIp);

    cookieStore.set(ADMIN_COOKIE, token, {
      httpOnly: true,
      secure:   false,  // HTTP server — secure:true would cause browser to reject the cookie
      sameSite: 'lax', // 'strict' blocks POST from sub-domains; 'lax' allows GET navigations
      path:     '/',
      maxAge:   60 * 60 * 24, // 24 hours
    });

    console.log(
      devBypass
        ? '[ADMIN_LOGIN] Dev bypass login — static token issued (ADMIN_DEV_BYPASS=1).'
        : customEntry
          ? `[ADMIN_LOGIN] Login successful (custom password v${customEntry.version}) — HMAC token issued.`
          : '[ADMIN_LOGIN] Login successful — HMAC token issued.',
      { ip: clientIp }
    );
    return NextResponse.json({ ok: true });

  } catch (error) {
    console.error('[ADMIN_LOGIN] Unexpected error:', error);
    return NextResponse.json(
      { ok: false, error: '服务器内部错误' },
      { status: 500 }
    );
  }
}

// Rate limit retry-after header — window matches lib/rateLimiter.ts
const WINDOW_MS = 60_000;
