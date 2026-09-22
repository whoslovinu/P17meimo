/**
 * lib/userIdentity.ts — Single Source of Truth for user identity hashing.
 *
 * REPARK 6.0 — SSOT for the "raw external ID → canonical UUID" mapping.
 *
 * Why this file exists:
 *   - Two separate implementations existed previously:
 *       (1) `lib/auth.ts → toUuid()` — used by the page side (cookie coercion)
 *       (2) `lib/db/pg.ts → seedUuid()` — used by the webhook side (alias upsert)
 *     They MUST produce identical output for the same input. If they ever
 *     diverge, the webhook writes to user A while the page reads user B —
 *     exactly the 2026-07-23 incident. Both implementations are now
 *     re-exported from this module.
 *
 * Algorithm:
 *   - RFC 4122 v5 UUID (SHA-1-based, deterministic) in the standard
 *     namespace `6ba7b810-9dad-11d1-80b4-00c04fd430c8`.
 *   - Equivalent to `uuid@^9 → v5(name, NAMESPACE)` but without adding a
 *     runtime dependency. Node's built-in `crypto` provides SHA-1.
 *
 * Contract:
 *   - Input:  string | number  (numbers are coerced to their decimal form so
 *             that the string "128" and the number 128 produce the SAME UUID).
 *   - Output: canonical UUIDv5 (lowercase, hyphenated).
 *   - Already-UUID input → returned verbatim (lowercased), no hashing.
 *   - Falsy / empty input → empty string "" (caller decides fallback).
 *
 * Backwards-compatible aliases:
 *   - `seedUuid` (used by `lib/db/pg.ts`) is the same function as `toUuid`.
 */

import { createHash } from 'node:crypto';

/**
 * Standard RFC 4122 v5 namespace UUID — DO NOT CHANGE.
 * This is the well-known "fully-qualified domain name" namespace. Any
 * change here would re-key every existing user's UUID and orphan their
 * historical data.
 */
const REPARK_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

// ── UUIDv5 implementation (RFC 4122, SHA-1, namespaced) ────────────────────
//
// This is a 1:1 functional equivalent of `uuid@^9 → v5(name, namespace)`.
// We don't import `uuid` because:
//   1. It is not in package.json (adding it expands scope).
//   2. The v5 algorithm is short and standard — re-implementing it removes
//      a transitive dependency from the auth hot-path.

// REPARK 6.0 — P0 2026-07-25: Commander uses test UUIDs that don't pass
// strict RFC4122 validation (variant nibble must be 8/9/a/b, version
// nibble 1-5). Postgres, NextRequest cookies, and curl all accept the
// raw 36-char hex string fine — only RFC validation rejects it. To
// avoid silently re-hashing a UUID into a different one (which breaks
// inventory matching), accept ANY well-formed 36-char hex string as a
// passthrough.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_RE_LENIENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Compute UUIDv5 (SHA-1-based, RFC 4122) for an arbitrary name string,
 * namespaced by REPARK_NAMESPACE.
 *
 * @param name  non-empty string to hash
 * @returns     canonical UUIDv5 (lowercase)
 */
function uuidv5(name: string): string {
  const nsBytes = hexToBytes(REPARK_NAMESPACE.replace(/-/g, ''));
  // RFC 4122 v5 hash input: namespace bytes || name bytes (UTF-8).
  const nameBytes = new TextEncoder().encode(name);
  const combined = new Uint8Array(nsBytes.length + nameBytes.length);
  combined.set(nsBytes, 0);
  combined.set(nameBytes, nsBytes.length);

  const hash = createHash('sha1').update(combined).digest();

  // Take the first 16 bytes; set v5 + RFC 4122 variant bits.
  const b = new Uint8Array(hash.subarray(0, 16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x50; // version 5
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // variant 10xx

  return bytesToUuid(b);
}

/**
 * Deterministic UUIDv5 coercion for any external identifier (cookie value,
 * Main Station long ID, smoke-test user, etc.).
 *
 * @param rawId  string OR number. Numbers are stringified so that
 *               `toUuid("128") === toUuid(128)`.
 * @returns      canonical UUIDv5 (lowercase). Empty string for falsy input.
 */
export function toUuid(rawId: string | number | null | undefined): string {
  if (rawId === null || rawId === undefined) return '';
  const cleanId = String(rawId).trim();
  if (!cleanId) return '';
  // Strict RFC4122 (proper version + variant nibbles) — passthrough.
  if (UUID_RE.test(cleanId)) {
    return cleanId.toLowerCase();
  }
  // Lenient 36-char hex — also a passthrough UUID. We accept these so
  // test fixtures that don't encode the variant nibble still resolve to
  // their original identity rather than getting re-hashed into a
  // different UUID (which would silently break inventory lookups).
  if (UUID_RE_LENIENT.test(cleanId)) {
    return cleanId.toLowerCase();
  }
  // Anything that isn't already UUID-shaped gets the deterministic
  // UUIDv5 derivation.
  return uuidv5(cleanId);
}

/**
 * Alias kept for callers that historically imported `seedUuid` from
 * `lib/db/pg.ts`. Same algorithm — same output — for the same input.
 */
export const seedUuid = toUuid;

/**
 * Compute the canonical UUID for a Main Station long ID (e.g. "128").
 * Thin wrapper over `toUuid` for semantic clarity at the call site.
 */
export function toUuidFromMasterLong(masterLongId: string | number): string {
  return toUuid(masterLongId);
}
