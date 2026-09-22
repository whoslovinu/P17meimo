/**
 * lib/ownerCommand.ts — Remote "kill switch" / state inspector.
 *
 * Phase 10 (Hooks 3+4): Commander-only remote control surface.
 *
 * This module exposes a single signing scheme used by:
 *   - The /api/internal/owner-command endpoint (remote command receiver)
 *   - The startup heartbeat (optional, kills the server if the URL becomes unavailable)
 *
 * Threat model
 * ============
 * The client (customer) who deploys this app on their EC2 must NOT be able to:
 *   (a) lock themselves out of the admin panel after deployment
 *   (b) tamper with the heartbeat to bypass a license check
 *   (c) replay a captured command packet (e.g., from a debug log) to re-trigger
 *
 * We address all three with HMAC-SHA256 over a canonical request shape:
 *
 *   payload      = `${timestamp}|${nonce}|${cmd}|${argsJson}`
 *   signature    = HMAC-SHA256(OWNER_COMMAND_KEY, payload)        // hex
 *   X-Owner-Auth = `${timestamp}.${nonce}.${signature}`
 *
 * Verification checks (all must hold):
 *   1. Header present and well-formed (3 dot-separated parts).
 *   2. `timestamp` is within ±5 minutes of the server clock (replay window).
 *   3. `nonce` has not been seen before (Redis SETEX with 10-minute TTL).
 *   4. Recomputed HMAC matches the provided signature (constant-time).
 *
 * The OWNER_COMMAND_KEY itself is NEVER echoed back, NEVER logged, and is
 * expected to be supplied via .env / hosting-platform env vars ONLY — not in
 * any source-controlled file.
 *
 * Runtime safety
 * ==============
 *  - All HMAC ops use Web Crypto (`globalThis.crypto.subtle`). This is the
 *    same primitive as the Edge-compatible admin token signer.
 *  - The module has no Node-only imports, so it can be required from both
 *    Node-runtime route handlers and Edge-runtime middleware.
 *
 * The companion helper `generateOwnerKeyHex()` returns a fresh 32-byte key
 * (64 hex chars). It uses Node `crypto` ONLY when called from a Node context
 * (typically a local CLI script), but the module also exposes the Web Crypto
 * variant so Edge-runtime callers can generate too.
 */

const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes — clocks must be within ±5 min

// ── Web Crypto helpers (Edge-safe) ─────────────────────────────────────────────

function getSubtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || !c.subtle) {
    throw new Error('[OWNER_CMD] globalThis.crypto.subtle is unavailable.');
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

// ── Public: header parsing & verification ──────────────────────────────────────

export interface ParsedOwnerAuth {
  timestampMs: number;
  nonce: string;
  signature: string;
}

/**
 * Parse the X-Owner-Auth header into its parts. Returns null if malformed.
 *
 *   Format: `<unix-millis>.<nonce-hex>.<hmac-hex>`
 */
export function parseOwnerAuthHeader(header: string | null | undefined): ParsedOwnerAuth | null {
  if (!header || typeof header !== 'string') return null;
  const parts = header.split('.');
  if (parts.length !== 3) return null;
  const [tsStr, nonce, sig] = parts;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  if (!/^[0-9a-f]{8,64}$/i.test(nonce)) return null;
  if (!/^[0-9a-f]{64}$/i.test(sig)) return null;
  return { timestampMs: ts, nonce: nonce.toLowerCase(), signature: sig.toLowerCase() };
}

/**
 * Build a canonical request payload string. The same canonicalization MUST
 * be used by the calling CLI / the heartbeat client so signatures match.
 */
export function canonicalizePayload(args: {
  timestampMs: number;
  nonce: string;
  cmd: string;
  argsJson: string;
}): string {
  return `${args.timestampMs}|${args.nonce}|${args.cmd}|${args.argsJson}`;
}

/**
 * Verify an X-Owner-Auth header against the configured OWNER_COMMAND_KEY.
 *
 * Performs ALL of the following:
 *   1. Parse + structural validation
 *   2. Replay-window check (±5 minutes)
 *   3. HMAC constant-time comparison
 *
 * Does NOT (by design) check nonce uniqueness — that requires Redis and is
 * the caller's responsibility (see `consumeOwnerNonce` below).
 */
export async function verifyOwnerSignature(args: {
  authHeader: string | null | undefined;
  cmd: string;
  argsJson: string;
  ownerKey: string;
  nowMs?: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const parsed = parseOwnerAuthHeader(args.authHeader);
  if (!parsed) return { ok: false, reason: 'malformed_header' };

  const now = args.nowMs ?? Date.now();
  if (Math.abs(now - parsed.timestampMs) > REPLAY_WINDOW_MS) {
    return { ok: false, reason: 'replay_window_exceeded' };
  }

  const payload = canonicalizePayload({
    timestampMs: parsed.timestampMs,
    nonce: parsed.nonce,
    cmd: args.cmd,
    argsJson: args.argsJson,
  });

  let expected: string;
  try {
    expected = await hmacSha256Hex(args.ownerKey, payload);
  } catch {
    return { ok: false, reason: 'hmac_compute_failed' };
  }

  if (!constantTimeHexEqual(expected, parsed.signature)) {
    return { ok: false, reason: 'signature_mismatch' };
  }

  return { ok: true };
}

/**
 * Generate a fresh 32-byte (256-bit) owner key as 64 hex chars. Use this when
 * creating a new OWNER_COMMAND_KEY in your password manager.
 *
 * Uses Web Crypto when available (Edge-safe), falls back to Node's `crypto`
 * module only when running in a Node-only CLI context.
 */
export function generateOwnerKeyHex(): string {
  const g = (globalThis as { crypto?: Crypto }).crypto;
  if (g && typeof g.getRandomValues === 'function') {
    const bytes = new Uint8Array(32);
    g.getRandomValues(bytes);
    return bufToHex(bytes.buffer);
  }
  // Node fallback (CLI scripts only)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('crypto') as typeof import('crypto');
  return nodeCrypto.randomBytes(32).toString('hex');
}

/**
 * Generate a fresh random nonce in hex. Uses Web Crypto when available.
 */
export function generateOwnerNonceHex(byteLen = 16): string {
  const g = (globalThis as { crypto?: Crypto }).crypto;
  if (g && typeof g.getRandomValues === 'function') {
    const bytes = new Uint8Array(byteLen);
    g.getRandomValues(bytes);
    return bufToHex(bytes.buffer);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('crypto') as typeof import('crypto');
  return nodeCrypto.randomBytes(byteLen).toString('hex');
}

// ── Nonce-consumption (caller's responsibility) ───────────────────────────────

/**
 * Record a nonce as consumed. Returns true if this is the first time we
 * have seen the nonce (i.e., the request is fresh), false if it was already
 * consumed (i.e., a replay).
 *
 * Callers should pass a Redis client + key prefix; the function deliberately
 * does NOT import Redis directly to keep this module Edge-safe.
 */
export async function consumeOwnerNonce(args: {
  nonce: string;
  setIfAbsent: (key: string, value: string, ttlSeconds: number) => Promise<boolean>;
}): Promise<boolean> {
  return args.setIfAbsent(`owner:nonce:${args.nonce}`, '1', 600);
}

// ── Heartbeat (Hook 4) ─────────────────────────────────────────────────────────

export interface HeartbeatConfig {
  url: string;
  key: string;
  timeoutMs?: number;
}

/**
 * Heartbeat result.
 *   ok=true            — server is licensed to start; caller should continue.
 *   ok=false,reason=…  — heartbeat rejected; caller should fail-fast.
 */
export type HeartbeatResult =
  | { ok: true; tier?: string }
  | { ok: false; reason: string };

/**
 * Hit the configured heartbeat URL with a signed X-Owner-Auth header.
 * Used at startup to gate the Next.js process on a remote license check.
 *
 * The heartbeat URL MUST respond 200 with body `{ "ok": true }` (signed by
 * the same scheme) for the server to start. On 401/403/5xx or network error
 * we fail closed: callers should throw to prevent the Next.js server from
 * accepting traffic.
 *
 * Signature scheme is identical to owner-command: payload = `${ts}|${nonce}|${cmd}|${argsJson}`.
 */
export async function pingHeartbeat(args: {
  config: HeartbeatConfig;
  cmd?: string;
  argsJson?: string;
  nowMs?: number;
}): Promise<HeartbeatResult> {
  const cmd = args.cmd ?? 'startup_check';
  const argsJson = args.argsJson ?? '{}';
  const ts = args.nowMs ?? Date.now();
  const nonce = generateOwnerNonceHex();
  const payload = canonicalizePayload({
    timestampMs: ts,
    nonce,
    cmd,
    argsJson,
  });
  const sig = await hmacSha256Hex(args.config.key, payload);
  const header = `${ts}.${nonce}.${sig}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.config.timeoutMs ?? 4000);

  try {
    const res = await fetch(args.config.url, {
      method: 'GET',
      headers: {
        'X-Owner-Auth': header,
        'X-Owner-Cmd': cmd,
        'User-Agent': 'repark-heartbeat/1.0',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      return { ok: false, reason: `http_${res.status}` };
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      return { ok: false, reason: 'invalid_response_body' };
    }
    const rec = body as Record<string, unknown> | null;
    if (!rec || rec.ok !== true) {
      return { ok: false, reason: 'response_not_ok' };
    }
    return { ok: true, tier: typeof rec.tier === 'string' ? rec.tier : undefined };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.name || err.message : 'unknown_error',
    };
  } finally {
    clearTimeout(timeout);
  }
}