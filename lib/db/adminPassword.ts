/**
 * lib/db/adminPassword.ts — Dynamic admin password storage (PostgreSQL + Redis).
 *
 * Architecture (per REPARK 6.0 audit report):
 *   - Source of truth: public.repark_config.key = 'custom_admin_password_hash'
 *     (config_json.hash = "<sha256-hex>"; config_json.version = N; updated_at)
 *   - Hot cache: Redis String key `repark:admin:password_hash` (10-minute TTL)
 *   - Fallback: process.env.ADMIN_SECRET_KEY (when KV row absent or empty)
 *
 * IMPORTANT — Decoupling invariant:
 *   The HMAC secret for the admin_token cookie IS STILL process.env.ADMIN_SECRET_KEY.
 *   Changing the login password does NOT invalidate existing HMAC tokens — they
 *   remain valid until natural 24h expiry OR an explicit `lock_admin` epoch.
 *   This avoids the "改完密码、踢掉自己" trap.
 *
 * Hashing scheme:
 *   Stored value = SHA-256(plaintext) → lowercase hex.
 *   Matches the comparison path in app/api/admin/login/route.ts so no new
 *   crypto surface area is introduced.
 */
import { getPostgresPool } from '@/lib/db/postgres';
import { getRedisClient } from '@/lib/redis';

export const ADMIN_PASSWORD_CONFIG_KEY = 'custom_admin_password_hash';
export const ADMIN_PASSWORD_CACHE_KEY = 'repark:admin:password_hash';
export const ADMIN_PASSWORD_CACHE_TTL_SECONDS = 600; // 10 minutes

export interface AdminPasswordEntry {
  hash: string;
  version: number;
  updatedAt: string;
}

/**
 * Read the currently active custom admin password hash.
 *
 * Returns `null` when:
 *   • the KV row is missing
 *   • the row exists but config_json.hash is empty
 *   • Redis returns cached null (treated as "no custom password, fall back to env")
 *
 * Callers must fall back to process.env.ADMIN_SECRET_KEY on null.
 *
 * Read path:
 *   1. Redis cache hit → return immediately
 *   2. Cache miss → query PostgreSQL repark_config
 *   3. Found → SET into Redis with TTL and return
 *   4. Not found → cache a sentinel "" for 1 minute and return null
 */
export async function getCustomAdminPasswordHash(): Promise<AdminPasswordEntry | null> {
  // ── Step 1: Redis hot path ─────────────────────────────────────────────
  try {
    const redis = getRedisClient();
    const cached = await redis.get(ADMIN_PASSWORD_CACHE_KEY);
    if (cached === '__MISSING__') {
      return null;
    }
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as AdminPasswordEntry;
        if (parsed && typeof parsed.hash === 'string' && parsed.hash.length > 0) {
          return parsed;
        }
      } catch {
        // Corrupt cache → ignore, fall through to PG.
      }
    }
  } catch (err) {
    // Redis down — log once, fall through to PG.
    console.warn('[ADMIN_PW] redis cache read failed, falling back to PG:', err);
  }

  // ── Step 2: PostgreSQL read ────────────────────────────────────────────
  let entry: AdminPasswordEntry | null = null;
  try {
    const pool = getPostgresPool();
    const result = await pool.query<{ config_json: AdminPasswordEntry }>(
      `SELECT config_json
         FROM public.repark_config
        WHERE key = $1
        LIMIT 1`,
      [ADMIN_PASSWORD_CONFIG_KEY]
    );
    const row = result.rows[0]?.config_json;
    if (row && typeof row.hash === 'string' && row.hash.length > 0) {
      entry = row;
    }
  } catch (err) {
    console.error('[ADMIN_PW] postgres read failed:', err);
    throw err;
  }

  // ── Step 3: refresh Redis cache ────────────────────────────────────────
  try {
    const redis = getRedisClient();
    if (entry) {
      await redis.set(
        ADMIN_PASSWORD_CACHE_KEY,
        JSON.stringify(entry),
        'EX',
        ADMIN_PASSWORD_CACHE_TTL_SECONDS
      );
    } else {
      // Negative-cache "no custom password" for 60s so we don't hammer PG
      // on every login when no override exists.
      await redis.set(ADMIN_PASSWORD_CACHE_KEY, '__MISSING__', 'EX', 60);
    }
  } catch (err) {
    console.warn('[ADMIN_PW] redis cache write failed (non-fatal):', err);
  }

  return entry;
}

/**
 * Persist a new custom admin password hash (UPSERT).
 *
 * Writes:
 *   • public.repark_config row (atomic INSERT … ON CONFLICT DO UPDATE)
 *   • Redis cache: SET the new entry with TTL
 *
 * Caller must compute hash = sha256(plaintext) before calling.
 */
export async function setCustomAdminPasswordHash(
  newHash: string,
  operatorId: string
): Promise<AdminPasswordEntry> {
  if (typeof newHash !== 'string' || newHash.length !== 64) {
    throw new Error(
      '[ADMIN_PW] setCustomAdminPasswordHash requires a 64-char SHA-256 hex digest'
    );
  }

  const pool = getPostgresPool();
  const nowIso = new Date().toISOString();
  const payload: AdminPasswordEntry = {
    hash: newHash.toLowerCase(),
    version: 1,
    updatedAt: nowIso,
  };

  // Read existing row to bump version atomically.
  const existing = await pool.query<{ config_json: AdminPasswordEntry }>(
    `SELECT config_json FROM public.repark_config WHERE key = $1 LIMIT 1`,
    [ADMIN_PASSWORD_CONFIG_KEY]
  );
  const prev = existing.rows[0]?.config_json;
  payload.version = (prev?.version ?? 0) + 1;
  payload.updatedAt = nowIso;

  await pool.query(
    `INSERT INTO public.repark_config (key, config_json, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE
       SET config_json = EXCLUDED.config_json,
           updated_at  = EXCLUDED.updated_at`,
    [ADMIN_PASSWORD_CONFIG_KEY, JSON.stringify({ ...payload, updatedBy: operatorId })]
  );

  // Refresh Redis cache (best effort).
  try {
    const redis = getRedisClient();
    await redis.set(
      ADMIN_PASSWORD_CACHE_KEY,
      JSON.stringify(payload),
      'EX',
      ADMIN_PASSWORD_CACHE_TTL_SECONDS
    );
  } catch (err) {
    console.warn('[ADMIN_PW] redis cache refresh after write failed (non-fatal):', err);
  }

  return payload;
}

/**
 * Invalidate the cache (used by admin emergency "force re-read" operations).
 */
export async function invalidateAdminPasswordCache(): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(ADMIN_PASSWORD_CACHE_KEY);
  } catch (err) {
    console.warn('[ADMIN_PW] cache invalidation failed:', err);
  }
}

/**
 * Clear the custom password override, restoring login to use
 * process.env.ADMIN_SECRET_KEY (the default value).
 *
 * REPARK 6.0 (2026-07-29): operator emergency "reset to default password".
 * Deletes the PG row (if any) and re-caches the negative sentinel in Redis
 * so the next login read returns null immediately.
 *
 * Idempotent — safe to call when no row exists.
 *
 * @returns true when a row was deleted, false when no row existed.
 */
export async function clearCustomAdminPasswordHash(): Promise<boolean> {
  const pool = getPostgresPool();
  const result = await pool.query<{ key: string }>(
    `DELETE FROM public.repark_config
      WHERE key = $1
      RETURNING key`,
    [ADMIN_PASSWORD_CONFIG_KEY]
  );
  const deleted = result.rows.length > 0;

  // Always invalidate the Redis cache (whether a row was deleted or not)
  // so the next read re-queries PG or returns the fresh negative sentinel.
  await invalidateAdminPasswordCache();

  if (deleted) {
    console.log('[ADMIN_PW] custom password override cleared — login falls back to env.');
  } else {
    console.log('[ADMIN_PW] clearCustomAdminPasswordHash: no row to delete, cache invalidated.');
  }
  return deleted;
}