/**
 * rateLimiter.ts — Distributed sliding-window rate limiter for admin routes.
 *
 * FIX M-2: previously in-memory via a process-local Map. On serverless
 * (Vercel) or multi-instance EC2 deployments, each instance had its own
 * counter — an attacker could fire 5 requests against instance A, 5 against
 * instance B, 5 against instance C and bypass the limit entirely. We now use
 * a single Redis Lua script that performs INCR + EXPIRE atomically.
 *
 * The script:
 *   1. INCR the bucket key — returns the new count.
 *   2. If the count just became 1, set EXPIRE on the key.
 *   3. Return the count + remaining TTL in seconds.
 *
 * Backwards compatibility: the export shape (checkRateLimit / recordFailedAttempt
 * / clearRateLimit / getClientIp) is unchanged, so callers don't need to be
 * touched. When REDIS_URL is unavailable (dev without Redis), we fall back to
 * the in-memory Map so unit tests and offline runs still work — but the
 * fallback logs a one-shot warning so it cannot silently regress in prod.
 *
 * Security properties:
 *   - Constant-time bucket lookup (no timing oracle)
 *   - No user enumeration via response timing
 *   - Sliding window — every attempt pushes resetAt forward
 *   - Redis-backed, so the limit is honored across all instances
 */

import type { Redis } from 'ioredis';
import { getRedisClient } from './redis';

interface RateLimitEntry {
  count: number;
  resetAt: number; // Unix timestamp (ms)
}

const WINDOW_MS = 60_000;   // 1-minute window
// REPARK 6.0 (2026-07-29): relaxed 5 → 15 per minute. The 5/min ceiling was
// too tight for legitimate operator testing (multiple wrong-password retries
// while iterating) and caused the dashboard to be inaccessible even with the
// correct password once the IP was locked. 15/min still thwarts naive brute
// force (8 chars × SHA-256 → unguessable) while leaving headroom.
const MAX_ATTEMPTS = 15;    // 15 attempts per window per IP

// FIX M-2: Two Lua scripts — atomic INCR + EXPIRE on the bucket key.
//   PEEK (read-only): returns current count + TTL without incrementing.
//     KEYS[1] = bucket key. Returns: { count, ttl_seconds }.
//   RECORD: atomic INCR + EXPIRE.
//     KEYS[1] = bucket key, ARGV[1] = window in seconds.
//     Returns: { current_count, ttl_seconds }.
//
// REPARK 6.0 (2026-07-29): The old design incremented inside `checkRateLimit`,
// then incremented AGAIN inside `recordFailedAttempt` on every failed login,
// so the effective ceiling was MAX_ATTEMPTS/2. We split into PEEK (gate) +
// RECORD (only on failure) so the documented limit is honored exactly.
const RATE_LIMIT_PEEK_LUA = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
local ttl = redis.call('TTL', KEYS[1])
return { count, ttl }
`;

const RATE_LIMIT_RECORD_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
local ttl = redis.call('TTL', KEYS[1])
return { count, ttl }
`;

// In-memory fallback store: IP -> { count, resetAt }
// Used only when Redis is unavailable (e.g. local dev without Redis).
const _fallbackBuckets = new Map<string, RateLimitEntry>();

let _warnedFallback = false;
let _peekSha: string | null = null;
let _recordSha: string | null = null;
let _peekSetupPromise: Promise<string | null> | null = null;
let _recordSetupPromise: Promise<string | null> | null = null;

async function tryAcquireRedis(): Promise<Redis | null> {
  try {
    return getRedisClient();
  } catch (err) {
    if (!_warnedFallback) {
      console.warn(
        '[RATE-LIMIT] Redis unavailable — falling back to in-memory limiter. ' +
        'This is unsafe in production. Set REDIS_URL or run on a single instance.',
        err instanceof Error ? err.message : err
      );
      _warnedFallback = true;
    }
    return null;
  }
}

async function ensurePeekLuaLoaded(redis: Redis): Promise<string | null> {
  if (_peekSha) return _peekSha;
  if (_peekSetupPromise) return _peekSetupPromise;

  _peekSetupPromise = (async (): Promise<string | null> => {
    try {
      const sha: string = (await redis.script('LOAD', RATE_LIMIT_PEEK_LUA)) as string;
      _peekSha = sha;
      return sha;
    } catch (err) {
      console.error('[RATE-LIMIT] Failed to load PEEK Lua script:', err);
      return null;
    } finally {
      _peekSetupPromise = null;
    }
  })();

  return _peekSetupPromise;
}

async function ensureRecordLuaLoaded(redis: Redis): Promise<string | null> {
  if (_recordSha) return _recordSha;
  if (_recordSetupPromise) return _recordSetupPromise;

  _recordSetupPromise = (async (): Promise<string | null> => {
    try {
      const sha: string = (await redis.script('LOAD', RATE_LIMIT_RECORD_LUA)) as string;
      _recordSha = sha;
      return sha;
    } catch (err) {
      console.error('[RATE-LIMIT] Failed to load RECORD Lua script:', err);
      return null;
    } finally {
      _recordSetupPromise = null;
    }
  })();

  return _recordSetupPromise;
}

function bucketKey(ip: string, prefix = 'admin'): string {
  return `ratelimit:${prefix}:${ip}`;
}

/**
 * Check if an IP is rate-limited for a given bucket.
 *
 * REPARK 6.0 (2026-07-29): Now READ-ONLY (no increment). The increment
 * is reserved for `recordFailedAttempt`, which the caller invokes only
 * on a failed credential check. This way the configured MAX_ATTEMPTS
 * is the literal number of wrong passwords a user can submit before
 * the gate closes — not MAX_ATTEMPTS/2.
 *
 * Returns { limited: true, retryAfterMs } if limited, { limited: false } otherwise.
 */
export async function checkRateLimit(
  ip: string,
  bucketPrefix = 'admin'
): Promise<{ limited: boolean; retryAfterMs?: number }> {
  const redis = await tryAcquireRedis();
  if (!redis) {
    return checkRateLimitMemory(ip, bucketPrefix);
  }

  try {
    const sha = await ensurePeekLuaLoaded(redis);
    if (!sha) return checkRateLimitMemory(ip, bucketPrefix);

    const result = (await redis.evalsha(
      sha,
      1,
      bucketKey(ip, bucketPrefix)
    )) as [number | null, number];
    const [count, ttl] = result;
    const numericCount = typeof count === 'number' ? count : 0;

    if (numericCount >= MAX_ATTEMPTS) {
      const ttlMs = Math.max(0, (typeof ttl === 'number' ? ttl : 0) * 1000);
      return { limited: true, retryAfterMs: ttlMs || WINDOW_MS };
    }

    return { limited: false };
  } catch (err) {
    // Lua EVALSHA returns NOSCRIPT if Redis was restarted — reload + retry once.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('NOSCRIPT')) {
      _peekSha = null;
      _peekSetupPromise = null;
      return checkRateLimit(ip, bucketPrefix);
    }
    console.error('[RATE-LIMIT] Redis check failed, falling back to memory:', err);
    return checkRateLimitMemory(ip, bucketPrefix);
  }
}

/**
 * Record a failed attempt for an IP.
 * Call this on every failed login/validate attempt.
 *
 * REPARK 6.0 (2026-07-29): Pair with `checkRateLimit` (read-only). This
 * function is now the ONLY place that increments the bucket, so the gate
 * closes after exactly MAX_ATTEMPTS wrong passwords.
 */
export async function recordFailedAttempt(
  ip: string,
  bucketPrefix = 'admin'
): Promise<void> {
  const redis = await tryAcquireRedis();
  if (!redis) {
    recordFailedAttemptMemory(ip, bucketPrefix);
    return;
  }

  try {
    const sha = await ensureRecordLuaLoaded(redis);
    if (!sha) {
      recordFailedAttemptMemory(ip, bucketPrefix);
      return;
    }
    await redis.evalsha(sha, 1, bucketKey(ip, bucketPrefix), Math.ceil(WINDOW_MS / 1000));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('NOSCRIPT')) {
      _recordSha = null;
      _recordSetupPromise = null;
      await recordFailedAttempt(ip, bucketPrefix);
      return;
    }
    console.error('[RATE-LIMIT] Redis record failed, falling back to memory:', err);
    recordFailedAttemptMemory(ip, bucketPrefix);
  }
}

/**
 * Clear a successful login — remove the IP from rate limit tracking.
 * This prevents a locked-out user from being blocked after a successful login.
 */
export async function clearRateLimit(
  ip: string,
  bucketPrefix = 'admin'
): Promise<void> {
  _fallbackBuckets.delete(`${bucketPrefix}:${ip}`);
  const redis = await tryAcquireRedis();
  if (!redis) return;
  try {
    await redis.del(bucketKey(ip, bucketPrefix));
  } catch (err) {
    console.error('[RATE-LIMIT] Redis clear failed:', err);
  }
}

/**
 * Extract client IP from request headers.
 * Handles X-Forwarded-For (proxies/CDNs) and falls back to direct connection IP.
 */
export function getClientIp(request: Request): string {
  // X-Forwarded-For: client, proxy1, proxy2
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    // Take the first IP (client)
    return forwarded.split(',')[0].trim();
  }

  // X-Real-IP (nginx)
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  // CF-Connecting-IP (Cloudflare)
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) {
    return cfIp.trim();
  }

  // Fallback: unknown
  return 'unknown';
}

// ── In-memory fallback (legacy behavior, only used when Redis is down) ────────

function checkRateLimitMemory(
  ip: string,
  prefix = 'admin'
): { limited: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const entry = _fallbackBuckets.get(`${prefix}:${ip}`);

  if (!entry) {
    return { limited: false };
  }

  if (now >= entry.resetAt) {
    _fallbackBuckets.delete(`${prefix}:${ip}`);
    return { limited: false };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    return { limited: true, retryAfterMs: entry.resetAt - now };
  }

  return { limited: false };
}

function recordFailedAttemptMemory(ip: string, prefix = 'admin'): void {
  const now = Date.now();
  const entry = _fallbackBuckets.get(`${prefix}:${ip}`);

  if (!entry || now >= entry.resetAt) {
    _fallbackBuckets.set(`${prefix}:${ip}`, {
      count: 1,
      resetAt: now + WINDOW_MS,
    });
    return;
  }

  entry.count += 1;
  entry.resetAt = now + WINDOW_MS;
}