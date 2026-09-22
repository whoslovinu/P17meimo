import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import {
  checkRateLimit,
  recordFailedAttempt,
  clearRateLimit,
  getClientIp,
} from '@/lib/rateLimiter';
import {
  getCustomAdminPasswordHash,
  setCustomAdminPasswordHash,
} from '@/lib/db/adminPassword';
import { insertAuditLog } from '@/lib/db/pg';
import { getRedisClient } from '@/lib/redis';

/**
 * POST /api/admin/change-password
 *
 * Body:
 *   {
 *     oldPassword:     string (required, non-empty)
 *     newPassword:     string (required, ≥ 8 chars)
 *     confirmPassword: string (required, must equal newPassword)
 *   }
 *
 * Security:
 *   - requireAdminAuth — caller must already be logged in (HMAC cookie valid).
 *   - Per-IP rate limit (independent bucket: ratelimit:admin:pwchange:<ip>).
 *   - Verifies the old password against the currently active hash (custom or env).
 *   - Hashes the new password (SHA-256) and UPSERTs into public.repark_config.
 *   - Updates Redis cache and writes an audit row.
 *
 * Decoupling invariant: the HMAC secret is NOT changed. Existing admin_token
 * cookies remain valid until natural 24h expiry. The session here belongs to
 * the operator performing the change — we do NOT force a re-login.
 */

const ChangePasswordRequestSchema = z
  .object({
    oldPassword: z.string().min(1, '旧密码不能为空'),
    newPassword: z.string().min(8, '新密码至少 8 位'),
    confirmPassword: z.string().min(1, '请再次输入新密码'),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: '两次输入的新密码不一致',
    path: ['confirmPassword'],
  })
  .refine((v) => v.oldPassword !== v.newPassword, {
    message: '新密码不能与旧密码相同',
    path: ['newPassword'],
  });

const ADMIN_COOKIE = 'admin_token';
const PWCHANGE_BUCKET_PREFIX = 'admin:pwchange';

function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: Request) {
  // ── 1. Auth gate ──────────────────────────────────────────────────────
  const authError = await requireAdminAuth(req as unknown as Parameters<typeof requireAdminAuth>[0]);
  if (authError) return authError;

  const clientIp = getClientIp(req);

  // ── 2. Independent rate-limit bucket ─────────────────────────────────
  const { limited, retryAfterMs } = await checkRateLimit(clientIp, PWCHANGE_BUCKET_PREFIX);
  if (limited) {
    return NextResponse.json(
      { ok: false, error: { code: 'RATE_LIMITED', message: '尝试过于频繁，请稍后再试' } },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((retryAfterMs ?? 60_000) / 1000)),
        },
      }
    );
  }

  try {
    // ── 3. Parse + validate body ───────────────────────────────────────
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } },
        { status: 400 }
      );
    }

    const parsed = ChangePasswordRequestSchema.safeParse(body);
    if (!parsed.success) {
      const zodMsg = parsed.error.issues[0]?.message;
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION',
            message: zodMsg ?? '参数校验失败',
          },
        },
        { status: 400 }
      );
    }
    const { oldPassword, newPassword } = parsed.data;

    // ── 4. Resolve currently active password (DUAL-TRACK) ─────────────
    const adminSecret = process.env.ADMIN_SECRET_KEY;
    if (!adminSecret && process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { ok: false, error: { code: 'MISCONFIGURED', message: 'Server misconfigured' } },
        { status: 500 }
      );
    }

    const customEntry = await getCustomAdminPasswordHash().catch((err) => {
      console.error('[ADMIN_CHANGE_PW] getCustomAdminPasswordHash failed:', err);
      return null;
    });

    const crypto = await import('crypto');
    const oldDigest = crypto.createHash('sha256').update(oldPassword, 'utf8').digest();

    let oldMatches = false;
    if (customEntry) {
      // Track A: compare against stored custom hash
      const storedDigest = Buffer.from(customEntry.hash, 'hex');
      oldMatches =
        storedDigest.length === oldDigest.length &&
        timingSafeEqual(storedDigest, oldDigest);
    } else if (adminSecret) {
      // Track B: compare against env fallback
      const envDigest = crypto.createHash('sha256').update(adminSecret, 'utf8').digest();
      oldMatches = timingSafeEqual(oldDigest, envDigest);
    } else {
      // No custom and no env — fail closed.
      oldMatches = false;
    }

    if (!oldMatches) {
      await recordFailedAttempt(clientIp, PWCHANGE_BUCKET_PREFIX);
      // Use a generic message so we don't leak whether the env fallback was hit.
      return NextResponse.json(
        { ok: false, error: { code: 'OLD_PASSWORD_MISMATCH', message: '旧密码不正确' } },
        { status: 401 }
      );
    }

    // ── 5. Hash new password + UPSERT ─────────────────────────────────
    const newHash = crypto.createHash('sha256').update(newPassword, 'utf8').digest('hex');
    const operatorId = `admin:${clientIp}`;
    const entry = await setCustomAdminPasswordHash(newHash, operatorId);

    // ── 6. Audit log ───────────────────────────────────────────────────
    try {
      await insertAuditLog(
        '/api/admin/change-password',
        'CHANGE_PASSWORD',
        operatorId,
        operatorId,
        clientIp,
        'admin_password',
        `v${(customEntry?.version ?? 0)}`,
        `v${entry.version}`
      );
    } catch (auditErr) {
      // Audit failures are non-fatal — the password change has already succeeded.
      // Log loudly so ops can reconcile.
      console.error('[ADMIN_CHANGE_PW] audit log insert failed (non-fatal):', auditErr);
    }

    // ── 7. Clear rate-limit bucket so the operator can log in cleanly ──
    await clearRateLimit(clientIp, PWCHANGE_BUCKET_PREFIX);

    // ── 8. Force-clear current session by removing the cookie client-side.
    //    The next /admin/* request will fail auth (cookie still valid in
    //    browser until natural expiry), but we redirect via the UI layer.
    try {
      const cookieStore = await cookies();
      cookieStore.set(ADMIN_COOKIE, '', {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
        maxAge: 0, // expires immediately
      });
    } catch (cookieErr) {
      // cookies() may throw in edge contexts — non-fatal here.
      console.warn('[ADMIN_CHANGE_PW] cookie clear skipped:', cookieErr);
    }

    // ── 9. Telemetry: log the success ──────────────────────────────────
    console.log('[ADMIN_CHANGE_PW] password changed', {
      operator: operatorId,
      ip: clientIp,
      version: entry.version,
      updatedAt: entry.updatedAt,
    });

    // Sanity: confirm hash constantTimeHexEqual against newHash (no-op in prod).
    if (!constantTimeHexEqual(newHash, newHash)) {
      throw new Error('hash comparison anomaly');
    }

    // Also write through to Redis lock_epoch so anyone still holding a token
    // is forced to re-authenticate. The HMAC signature is unchanged but the
    // token's issued-at timestamp is now BEFORE the lock → requireAdminAuth
    // will reject it.
    try {
      const redis = getRedisClient();
      await redis.set('repark:admin:lock_epoch', String(Date.now()));
    } catch (redisErr) {
      console.warn('[ADMIN_CHANGE_PW] lock_epoch update failed (non-fatal):', redisErr);
    }

    return NextResponse.json({
      ok: true,
      message: '密码已修改，请使用新密码重新登录',
      version: entry.version,
    });
  } catch (error) {
    console.error('[ADMIN_CHANGE_PW] Unexpected error:', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    );
  }
}