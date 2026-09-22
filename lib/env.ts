/**
 * lib/env.ts — Single source of truth for environment variables.
 *
 * V6.0+ Addendum: Process-level env reads are centralized here so that
 *   (a) missing/invalid variables are documented in one place,
 *   (b) future migrations (e.g. Zod-validated `env.parse(process.env)`)
 *       touch only this file,
 *   (c) grep audits for `process.env.XXX` are easy to enforce.
 *
 * This module is intentionally **non-fatal**: every helper either
 * returns a sane default or logs a soft warning. Replacing one of these
 * with a hard `process.exit(1)` would change startup semantics and is
 * not appropriate without coordinated rollout.
 *
 * SRP: this file does NOT validate schema (no zod yet) — it just
 * normalizes access. Future Zod integration can wrap the `read` helpers.
 */

type NodeEnv = 'development' | 'production' | 'test';

function read(key: string, fallback?: string): string | undefined {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return v;
}

function readRequired(key: string, fallback?: string): string {
  const v = read(key, fallback);
  if (v === undefined) {
    // Soft warning — never throw. The caller decides whether this is fatal.
    if (typeof console !== 'undefined') {
      console.warn(`[env] ${key} is not set; using fallback=${JSON.stringify(fallback)}`);
    }
    return fallback as string;
  }
  return v;
}

function readInt(key: string, fallback: number): number {
  const raw = read(key);
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBool(key: string, fallback: boolean): boolean {
  const raw = read(key);
  if (raw === undefined) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export const env = {
  // ── Node runtime ───────────────────────────────────────────
  /** Current NODE_ENV. Defaults to 'development' for tooling that runs outside Next. */
  nodeEnv: (): NodeEnv =>
    (process.env.NODE_ENV as NodeEnv) ?? 'development',
  /** True when running with NODE_ENV=production. */
  isProd: (): boolean => process.env.NODE_ENV === 'production',
  /** True when running with NODE_ENV=development. */
  isDev: (): boolean => process.env.NODE_ENV !== 'production',

  // ── Application URLs ───────────────────────────────────────
  /** Public-facing app URL. Fallback: localhost:PORT (3000 by default). */
  appUrl: (): string =>
    process.env.NEXT_PUBLIC_APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,

  /** Auth cookie name set by the Main Station. Default: 'uid'. */
  authCookieName: (): string =>
    process.env.NEXT_PUBLIC_AUTH_COOKIE_NAME ?? 'uid',

  /** Main Station login redirect URL. */
  mainStationUrl: (): string =>
    process.env.NEXT_PUBLIC_MAIN_STATION_URL ?? 'https://main-station.example.com/login',

  /**
   * Main Station home URL — strips the /login path from NEXT_PUBLIC_MAIN_STATION_URL.
   * Used as the safe default return target for battle-page back navigation.
   * Falls back to '/' when the env var is unset or invalid.
   *
   * Example:
   *   NEXT_PUBLIC_MAIN_STATION_URL = "https://test.aidpzm.com/login"
   *   → returns "https://test.aidpzm.com"
   */
  mainStationHomeUrl: (): string => {
    const loginUrl = process.env.NEXT_PUBLIC_MAIN_STATION_URL;
    if (!loginUrl) return '/';
    try {
      const url = new URL(loginUrl);
      return url.origin; // protocol + hostname only
    } catch {
      return '/';
    }
  },

  // ── Admin authentication ───────────────────────────────────
  /** HMAC-SHA256 secret for admin_token cookie (login/route/validate). */
  adminSecret: (): string =>
    readRequired('ADMIN_SECRET_KEY', process.env.NODE_ENV === 'production' ? '' : 'dev-admin-secret-do-not-use-in-prod'),

  /** Dev-only bypass flag. */
  adminDevBypass: (): boolean => readBool('ADMIN_DEV_BYPASS', false),

  // ── Owner / Commander remote control ───────────────────────
  /** HMAC-SHA256 key for /api/internal/owner-command. OPTIONAL in dev. */
  ownerCommandKey: (): string | undefined => read('OWNER_COMMAND_KEY'),

  // ── Owner heartbeat (startup license check) ────────────────
  /** OPTIONAL heartbeat URL. When both url+key are set, /api/internal/startup checks it. */
  ownerHeartbeatUrl: (): string | undefined => read('OWNER_HEARTBEAT_URL'),
  ownerHeartbeatKey: (): string | undefined => read('OWNER_HEARTBEAT_KEY'),

  // ── Webhook signature verification ─────────────────────────
  /** Secret for verifying Main Station webhook signatures. Min 32 chars recommended. */
  webhookSecret: (): string | undefined => read('WEBHOOK_SECRET'),

  // ── Voice / Audio CDN ──────────────────────────────────────
  /** Base URL for character voice clips. Default '/voice' (CDN fallback). */
  voiceBaseUrl: (): string => process.env.NEXT_PUBLIC_VOICE_BASE_URL ?? '/voice',

  // ── Game tuning ────────────────────────────────────────────
  /** Daily energy task threshold (default 100). */
  taskThresholdEnergy: (): number =>
    readInt('NEXT_PUBLIC_TASK_THRESHOLD_ENERGY', 100),

  /** Daily recharge task threshold (default 5000 cents = ¥50). */
  taskThresholdRecharge: (): number =>
    readInt('NEXT_PUBLIC_TASK_THRESHOLD_RECHARGE', 5000),

  /** Max items per type a commander may grant (admin endpoint safety cap). */
  adminInventoryMaxPerType: (): number =>
    readInt('ADMIN_INVENTORY_MAX_PER_TYPE', 10_000),

  // ── Server port ────────────────────────────────────────────
  /** HTTP listen port. Default 3000. */
  port: (): number => readInt('PORT', 3000),
};

/**
 * Validate at startup. Call from /api/internal/startup if you want
 * a full check. Returns a list of issues (empty = healthy).
 */
export function validateEnv(): { ok: boolean; issues: string[] } {
  const issues: string[] = [];

  if (env.isProd()) {
    if (!process.env.ADMIN_SECRET_KEY) {
      issues.push('ADMIN_SECRET_KEY is required in production');
    } else if (process.env.ADMIN_SECRET_KEY.length < 32) {
      issues.push('ADMIN_SECRET_KEY should be ≥ 32 chars (HMAC-SHA256 strength)');
    }
    if (!process.env.DATABASE_URL) {
      issues.push('DATABASE_URL is required in production');
    }
    if (!process.env.REDIS_URL) {
      issues.push('REDIS_URL is required in production');
    }
  }

  return { ok: issues.length === 0, issues };
}
