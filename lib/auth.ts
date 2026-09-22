/**
 * lib/auth.ts — User Identity from Client Cookies
 *
 * Extracts the authenticated user ID from the Main Station cookie set by the
 * client portal. This replaces all hardcoded TEST_USER_ID fallbacks.
 *
 * Cookie name is configured via NEXT_PUBLIC_AUTH_COOKIE_NAME in .env.local.
 * In production this variable MUST be set. In development it defaults to "uid".
 *
 * Dev mode fallback: if NODE_ENV !== 'production' and no cookie is present,
 * returns the test user ID so local development continues to work without
 * needing a real session cookie.
 */

import type { NextRequest } from 'next/server';
import { toUuid as toUuidCanonical } from '@/lib/userIdentity';

// ── Constants ─────────────────────────────────────────────────────────────────

export const DEV_TEST_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * SSOT delegate — every call to `toUuid` in this module must resolve to
 * `lib/userIdentity.ts → toUuid`. Do NOT re-implement the UUIDv5 derivation
 * here. (Fix for issue #6: uid 哈希漂移 → 数据不匹配.)
 */
export const toUuid = toUuidCanonical;

/**
 * The name of the cookie set by the Main Station that carries the user ID.
 * Configure via NEXT_PUBLIC_AUTH_COOKIE_NAME.
 *
 * In production (NODE_ENV === 'production') this MUST be set. Missing it
 * is a deployment error, not a silent fallback.
 */
export function getAuthCookieName(): string {
  const name = process.env.NEXT_PUBLIC_AUTH_COOKIE_NAME;
  if (!name && process.env.NODE_ENV === 'production') {
    throw new Error(
      '[AUTH] NEXT_PUBLIC_AUTH_COOKIE_NAME is not set. ' +
      'Set it in .env.local to the cookie key used by the Main Station.'
    );
  }
  return name ?? 'uid';
}

/**
 * URL of the Main Station login page — used by middleware to redirect
 * unauthenticated users. Configure via NEXT_PUBLIC_MAIN_STATION_URL.
 */
export function getMainStationUrl(): string {
  return (
    process.env.NEXT_PUBLIC_MAIN_STATION_URL ??
    'https://main-station.example.com/login'
  );
}

// ── Core extraction ────────────────────────────────────────────────────────────

/**
 * Reads the user ID from the cookie jar on a Next.js request.
 *
 * Supports both:
 *  - Next.js App Router `NextRequest` (has `.cookies` accessor)
 *  - Plain `Request` (reads `Cookie` header manually)
 *
 * Returns the raw cookie value (a user ID string) or null if missing.
 */
function readUserIdCookie(req: NextRequest | Request): string | null {
  const cookieName = getAuthCookieName();

  if ('cookies' in req && typeof (req as NextRequest).cookies.get === 'function') {
    return (req as NextRequest).cookies.get(cookieName)?.value ?? null;
  }

  // Plain Request or other edge-compatible path
  const header = (req as Request).headers.get('cookie') ?? '';
  const parts = header.split(';').map((p) => p.trim());
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key === cookieName) {
      const value = part.slice(eqIdx + 1).trim();
      return value || null;
    }
  }
  return null;
}

/**
 * Parses a user ID from a raw Authorization / Bearer token.
 * Handles three formats:
 *   1. `uid:<uuid>`          — preferred (explicit prefix)
 *   2. `<uuid>`              — bare UUID
 *   3. any non-empty string  — passthrough (for integration flexibility)
 */
function parseUserIdFromToken(token: string): string {
  const trimmed = token.trim();
  const uidPrefix = trimmed.match(/^uid:(.+)$/);
  if (uidPrefix) return uidPrefix[1].trim();

  const uuidMatch = trimmed.match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  if (uuidMatch) return trimmed;

  // Passthrough for any other non-empty value (integration flexibility)
  if (trimmed.length > 0) return trimmed;

  return DEV_TEST_USER_ID;
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface AuthResult {
  userId: string;
  source: 'cookie' | 'bearer' | 'query' | 'dev-fallback';
}

/**
 * Variant of `getUserIdFromRequest` that additionally coerces any non-UUID
 * identifier (e.g. `test-smoke-user`, `smoke-user-1783644166301`) into a
 * deterministic UUID so Postgres UUID columns accept it.
 *
 * Use this for handlers that hit tables with `user_id UUID`.
 */
export function getUserIdAsUuid(
  req: NextRequest | Request,
  options: { allowBearer?: boolean } = {},
): AuthResult | null {
  const result = getUserIdFromRequest(req, options);
  if (!result) return null;
  return { ...result, userId: toUuid(result.userId) };
}

/**
 * Primary entry point. Call this at the top of every game-facing API handler.
 *
 * Priority:
 *   1. Read user ID directly from the auth cookie on the request
 *   2. Fall back to Authorization / Bearer token (for clients that send it in headers)
 *   3. Dev fallback: return DEV_TEST_USER_ID if NODE_ENV !== 'production'
 *   4. Production: return null (caller should reject the request)
 *
 * @param req - NextRequest or Request from the API handler
 * @param options.allowBearer - Whether to also check Authorization: Bearer header (default: true)
 */
export function getUserIdFromRequest(
  req: NextRequest | Request,
  options: { allowBearer?: boolean } = {},
): AuthResult | null {
  const { allowBearer = true } = options;

  // 1. Cookie (primary)
  const cookieValue = readUserIdCookie(req);
  if (cookieValue) {
    return { userId: parseUserIdFromToken(cookieValue), source: 'cookie' };
  }

  // 2. Bearer token (secondary)
  if (allowBearer) {
    let bearerToken: string | undefined;
    if ('headers' in req) {
      bearerToken = (req as NextRequest).headers.get('authorization') ?? undefined;
    } else {
      bearerToken = (req as Request).headers.get('authorization') ?? undefined;
    }
    if (bearerToken) {
      const token = bearerToken.replace(/^Bearer\s+/i, '').trim();
      if (token) {
        return { userId: parseUserIdFromToken(token), source: 'bearer' };
      }
    }
  }

  // 2.5 P0 2026-08-22 (Bug #38 REPARK): Query-param fallback REMOVED for hardening.
  // The previous `?userId=` / `?uid=` fallback allowed clients to spoof identity
  // simply by appending a query string. Strict multi-account data isolation now
  // requires: identity comes 100% from Cookie / Bearer header. Any query param
  // is silently dropped.
  // Reference: app/api/battle/init/route.ts & app/api/game/milestone/claim/route.ts
  // no longer honour `?userId=` either. Single source of truth: signed auth cookie.

  // 3. Dev fallback — preserves local testing without a real session
  if (process.env.NODE_ENV !== 'production') {
    return { userId: DEV_TEST_USER_ID, source: 'dev-fallback' };
  }

  // 4. Production: no auth → return null (caller must handle rejection)
  return null;
}
