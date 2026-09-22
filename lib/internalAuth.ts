/**
 * lib/internalAuth.ts — Hardened gate for /api/internal/* endpoints.
 *
 * The previous design relied on path obscurity (`/api/internal/*` was
 * simply "not covered by /api/admin/*"). Anyone who guessed the URL
 * could call the startup hook. Now every internal call must carry an
 * `X-Internal-Token` header signed with HMAC-SHA256 over a canonical
 * payload.
 *
 * Threat model
 * ============
 * Anyone on the public internet can hit /api/internal/startup. They
 * must NOT be able to:
 *   (a) call it without holding the shared secret
 *   (b) replay a captured request (timestamp window + nonce)
 *   (c) brute-force the HMAC (constant-time compare + key length floor)
 *
 * Signature scheme (mirror of lib/ownerCommand.ts, but simpler)
 * =============================================================
 *   payload      = `${timestampMs}.${nonce}`
 *   signature    = HMAC-SHA256(INTERNAL_STARTUP_KEY, payload)     // hex
 *   X-Internal-Token = `${timestampMs}.${nonce}.${signature}`
 *
 * Verification:
 *   1. Header present + 3 dot-separated parts
 *   2. timestampMs within ±5 minutes of server clock
 *   3. constant-time HMAC compare
 *   4. nonce uniqueness (Redis SET NX with 10-min TTL)
 *
 * Header only — no body args, no method ambiguity. startup is GET-only.
 *
 * Config
 * ======
 *   INTERNAL_STARTUP_KEY  — required, ≥32 chars
 *                           Set via .env.local / hosting-platform env vars.
 *                           NEVER committed to source.
 *
 * If the env var is missing:
 *   - production: ALL internal calls are rejected (fail-closed)
 *   - dev:        loopback calls (127.0.0.1, ::1) are allowed so local
 *                 `curl http://localhost:3000/api/internal/startup`
 *                 keeps working. Remote calls still get 503.
 */

// ── Constants ───────────────────────────────────────────────────────────────

const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ── Web Crypto helpers (Edge-safe) ──────────────────────────────────────────

function getSubtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || !c.subtle) {
    throw new Error('[INTERNAL_AUTH] globalThis.crypto.subtle is unavailable.');
  }
  return c.subtle;
}

const _keyCache = new Map<string, CryptoKey>();
async function importHmacKey(secret: string): Promise<CryptoKey> {
  const cached = _keyCache.get(secret);
  if (cached) return cached;
  const subtle = getSubtle();
  const key = await subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  _keyCache.set(secret, key);
  return key;
}

async function hmacSha256Hex(secret: string, msg: string): Promise<string> {
  const subtle = getSubtle();
  const key = await importHmacKey(secret);
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

function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ── Header parsing ──────────────────────────────────────────────────────────

export interface ParsedInternalToken {
  timestampMs: number;
  nonce: string;
  signature: string;
}

export function parseInternalTokenHeader(header: string | null | undefined): ParsedInternalToken | null {
  if (!header || typeof header !== 'string') return null;
  const parts = header.split('.');
  if (parts.length !== 3) return null;
  const [tsStr, nonce, sig] = parts;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  if (!/^[0-9a-f]{8,64}$/i.test(nonce)) return null;
  if (!/^[a-f0-9]{64}$/i.test(sig)) return null;
  return { timestampMs: ts, nonce: nonce.toLowerCase(), signature: sig.toLowerCase() };
}

// ── Public: verify (caller supplies the Redis SETNX adapter) ────────────────

export type NonceAdapter = (key: string, ttlSeconds: number) => Promise<boolean>;

export interface VerifyInternalTokenArgs {
  authHeader: string | null | undefined;
  internalKey: string;
  /** Provided so tests can pin the clock. */
  nowMs?: number;
}

export type VerifyInternalTokenResult =
  | { ok: true; nonce: string }
  | { ok: false; reason: string };

export async function verifyInternalTokenAsync(args: VerifyInternalTokenArgs): Promise<VerifyInternalTokenResult> {
  const parsed = parseInternalTokenHeader(args.authHeader);
  if (!parsed) return { ok: false, reason: 'malformed_header' };

  const now = args.nowMs ?? Date.now();
  if (Math.abs(now - parsed.timestampMs) > REPLAY_WINDOW_MS) {
    return { ok: false, reason: 'replay_window_exceeded' };
  }

  const payload = `${parsed.timestampMs}.${parsed.nonce}`;
  let expected: string;
  try {
    expected = await hmacSha256Hex(args.internalKey, payload);
  } catch {
    return { ok: false, reason: 'hmac_compute_failed' };
  }

  if (!constantTimeHexEqual(expected, parsed.signature)) {
    return { ok: false, reason: 'signature_mismatch' };
  }

  return { ok: true, nonce: parsed.nonce };
}

// ── Helpers for callers ─────────────────────────────────────────────────────

/**
 * Returns the configured internal key, or null if missing.
 * Logs a loud warning on first call when missing — operators tend to
 * miss this until the first internal call 503s.
 */
let _warnedMissing = false;
export function getInternalKey(): string | null {
  const key = process.env.INTERNAL_STARTUP_KEY;
  if (!key || key.length < 32) {
    if (!_warnedMissing) {
      console.warn(
        '[INTERNAL_AUTH] INTERNAL_STARTUP_KEY is missing or shorter than 32 chars. ' +
        'Internal endpoints will reject all callers. Set INTERNAL_STARTUP_KEY in .env.local ' +
        '(generate with: node scripts/generate-internal-key.mjs).'
      );
      _warnedMissing = true;
    }
    return null;
  }
  return key;
}

/**
 * Returns true if the request looks like a loopback call. In dev mode
 * we allow loopback callers to hit internal endpoints WITHOUT the
 * signed header — so `curl http://localhost:3000/api/internal/startup`
 * keeps working without a key in `.env`. Remote calls in dev STILL
 * require the token.
 *
 * In production this returns false even for loopback: production must
 * always require the signed header. Loopback bypass is dev-only.
 */
export function isLoopbackRequest(req: Request): boolean {
  if (process.env.NODE_ENV === 'production') return false;

  // x-forwarded-for is the easiest hook for "did this come from localhost"
  const xff = req.headers.get('x-forwarded-for') ?? '';
  const xReal = req.headers.get('x-real-ip') ?? '';
  const candidates = [xff, xReal].flatMap((v) => v.split(',').map((s) => s.trim()));
  for (const ip of candidates) {
    if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  }

  // Hostname hint — Next.js dev usually reports host=localhost
  try {
    const url = new URL(req.url);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

// ── Shared authenticator for all /api/internal/* routes ─────────────────────

import { getRedisClient } from './redis';

/**
 * Returns a 401/503 NextResponse if the caller is not authorized, or null if
 * the caller is allowed through. Order of checks:
 *
 *   1. INTERNAL_STARTUP_KEY missing  → 503 in prod, allow in dev (only if
 *      the caller is loopback). This keeps local `curl` working.
 *   2. Caller is loopback in dev     → allow without token.
 *   3. X-Internal-Token header check → constant-time HMAC + 5-min replay
 *      window + nonce uniqueness (Redis SET NX, 10-min TTL).
 *   4. Failure → 401 with reason logged.
 *
 * Used by both /api/internal/startup and /api/internal/cron/*.
 */
export async function authenticateInternalCaller(req: Request): Promise<Response | null> {
  const isProd = process.env.NODE_ENV === 'production';

  // Step 1: key availability check
  const key = getInternalKey();
  if (!key) {
    if (isProd) {
      console.error(
        '[INTERNAL] FATAL: INTERNAL_STARTUP_KEY is not set in production. ' +
        'Refusing to service the internal channel.'
      );
      return jsonError(503, 'MISCONFIGURED', 'internal channel disabled');
    }
    if (!isLoopbackRequest(req)) {
      console.warn('[INTERNAL] Dev mode + INTERNAL_STARTUP_KEY missing + remote caller → rejecting.');
      return jsonError(
        503,
        'MISCONFIGURED',
        'INTERNAL_STARTUP_KEY is not set. Either set it in .env.local, ' +
        'or call this endpoint from loopback (127.0.0.1).'
      );
    }
    return null; // loopback + dev + no key → allow
  }

  // Step 2: loopback bypass (dev only)
  if (!isProd && isLoopbackRequest(req)) {
    return null;
  }

  // Step 3: verify the signed header
  const authHeader = req.headers.get('x-internal-token');
  const verifyResult = await verifyInternalTokenAsync({ authHeader, internalKey: key });
  if (!verifyResult.ok) {
    console.warn('[INTERNAL] Internal token rejected.', {
      reason: verifyResult.reason,
      ip: req.headers.get('x-forwarded-for') ?? 'unknown',
      ua: req.headers.get('user-agent') ?? 'unknown',
    });
    return jsonError(401, 'UNAUTHORIZED', `internal auth failed: ${verifyResult.reason}`);
  }

  // Step 4: replay protection (Redis SET NX, 10-min TTL)
  try {
    const redis = getRedisClient();
    const setResult = await redis.set(
      `internal:nonce:${verifyResult.nonce}`,
      '1',
      'EX',
      600,
      'NX'
    );
    if (setResult !== 'OK') {
      console.warn('[INTERNAL] Internal token replay detected.', { nonce: verifyResult.nonce });
      return jsonError(409, 'REPLAY_DETECTED', 'nonce already used');
    }
  } catch (err) {
    // Fail closed: refuse rather than allow potentially-replayed tokens.
    console.error('[INTERNAL] Redis nonce check failed — rejecting:', err);
    return jsonError(503, 'INTERNAL_AUTH_UNAVAILABLE', 'auth backend unavailable');
  }

  return null;
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ ok: false, error: { code, message } }),
    { status, headers: { 'content-type': 'application/json' } }
  );
}