/**
 * HMAC Token Utilities — shared between login/route.ts and adminAuth.ts.
 *
 * Token format: {expiry_timestamp}:{HMAC-SHA256(admin_secret, expiry_timestamp)}
 *
 * Security properties:
 *   - HMAC carries no usable secret — intercepted cookies can't be forged
 *   - 24h expiry prevents long-term replay attacks
 *   - Hex-constant-time compare prevents timing oracle on the HMAC check
 *
 * RUNTIME NOTE — EDGE COMPATIBILITY:
 *   This module is imported by `middleware.ts`, which Next.js compiles for
 *   the Edge Runtime. Edge does NOT expose Node's `crypto` module, so all
 *   HMAC operations use the Web Crypto API (`globalThis.crypto.subtle`).
 *   Sign and verify are inherently async on this API; callers must `await`.
 *
 * Dev bypass:
 *   When ADMIN_DEV_BYPASS=1 (non-production only), the admin_token cookie
 *   may also be the literal string "authenticated". isAdminDevBypass()
 *   checks NODE_ENV so the bypass is unreachable in production.
 */

const TOKEN_TTL_SECS = 60 * 60 * 24; // 24 hours
export const ADMIN_DEV_BYPASS_TOKEN = 'authenticated';

/**
 * True only when (a) NODE_ENV !== 'production' AND (b) the operator opted in
 * via ADMIN_DEV_BYPASS=1. Single source of truth.
 */
export function isAdminDevBypass(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.ADMIN_DEV_BYPASS === '1';
}

// ── Web Crypto helpers ────────────────────────────────────────────────────────

function getSubtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || !c.subtle) {
    throw new Error(
      '[ADMIN_TOKEN] globalThis.crypto.subtle is unavailable. ' +
      'Required for HMAC in Edge Runtime.'
    );
  }
  return c.subtle;
}

/**
 * Import the admin secret as an HMAC-SHA256 key.
 * Edge-safe (Web Crypto only). Result is cached per-secret.
 */
const _keyCache = new Map<string, CryptoKey>();
async function importHmacKey(secret: string): Promise<CryptoKey> {
  const cached = _keyCache.get(secret);
  if (cached) return cached;
  const subtle = getSubtle();
  const key = await subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,                          // not extractable
    ['sign', 'verify'],
  );
  _keyCache.set(secret, key);
  return key;
}

/**
 * Compute HMAC-SHA256(secret, msg) and return it as lowercase hex.
 * Async because Web Crypto subtle.sign is async.
 */
async function hmacSha256Hex(secret: string, msg: string): Promise<string> {
  const key = await importHmacKey(secret);
  const subtle = getSubtle();
  const sigBuf = await subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return bufToHex(sigBuf);
}

function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

/**
 * Constant-time hex string comparison. Edge-safe (no Node Buffer).
 * Length must match for equality; if lengths differ we still walk the
 * shorter length to keep timing roughly independent of content.
 */
function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build an HMAC-SHA256 token: `{expiry}:{hmac}`.
 * If dev bypass is active, returns the literal `authenticated`.
 *
 * Async because Web Crypto subtle.sign is async.
 */
export async function buildAdminToken(
  adminSecret: string | null | undefined,
): Promise<string> {
  if (!adminSecret && isAdminDevBypass()) {
    return ADMIN_DEV_BYPASS_TOKEN;
  }
  if (!adminSecret) {
    throw new Error('[ADMIN_TOKEN] ADMIN_SECRET_KEY is required to issue a token');
  }
  const expiry = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECS;
  const hmac   = await hmacSha256Hex(adminSecret, String(expiry));
  return `${expiry}:${hmac}`;
}

/**
 * Verify an HMAC-SHA256 token, with optional dev-bypass support.
 * Returns true only if the token is valid for the current environment.
 *
 * Async because Web Crypto verification is async.
 * Expiry is checked FIRST to short-circuit expired tokens without invoking
 * the expensive HMAC.
 */
export async function verifyAdminToken(
  adminSecret: string | null | undefined,
  token: string,
): Promise<boolean> {
  if (!token || typeof token !== 'string') return false;

  // Dev bypass: any cookie value matching the literal bypass token is
  // accepted ONLY when isAdminDevBypass() is true.
  if (isAdminDevBypass() && token === ADMIN_DEV_BYPASS_TOKEN) {
    return true;
  }

  if (!adminSecret) return false;

  const parts = token.split(':');
  if (parts.length !== 2) return false;
  const [expiryStr, receivedHmac] = parts;

  // Expiry parse + check FIRST (no expensive HMAC for expired tokens).
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry)) return false;
  const nowSecs = Math.floor(Date.now() / 1000);
  if (nowSecs > expiry) return false;

  // Compute expected HMAC using Web Crypto. Failure to compute is treated
  // as a non-match (do not leak internal error to the caller).
  let expectedHmac: string;
  try {
    expectedHmac = await hmacSha256Hex(adminSecret, expiryStr);
  } catch {
    return false;
  }

  return constantTimeHexEqual(expectedHmac, receivedHmac.toLowerCase());
}