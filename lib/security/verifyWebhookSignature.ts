import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Webhook Signature Verification Utility
 *
 * Provides HMAC-SHA256 signature verification for incoming webhooks.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * Accepts two header formats:
 *   - "sha256=<64-hex>"  (standard GitHub/GitLab style)
 *   - "<64-hex>"          (plain hex, no prefix — required for Main Station compat)
 * Header name: X-Webhook-Signature
 *
 * REPARK P0 2026-07-30 — DUAL-MODE compat:
 *   Main Station integration document specifies two mutually incompatible
 *   ways the sender may populate the `sign` field. Both must succeed:
 *
 *     MODE A — pre-filled zeros:
 *       payload = { ..., sign: "0000…0000" }
 *       signer computes HMAC over the *entire* body (including the zero
 *       `sign` field). Server receives this and must validate.
 *
 *     MODE B — omitted from body, back-filled:
 *       signer takes the 5 other fields, computes HMAC, then RE-INJECTS
 *       the resulting hex into the JSON body as `sign`. Server receives
 *       payload with `sign` already filled with the correct value.
 *
 *   In BOTH cases the server receives a JSON body whose `sign` matches
 *   `HMAC(body)`. Implementations differ only in *how the signer produced
 *   that body* — that's irrelevant to the verifier. The unified rule is:
 *
 *       "Verify HMAC of the rawBody bytes against the X-Webhook-Signature
 *        header (after stripping any 'sha256=' prefix)."
 *
 *   The legacy body-rewriting path ("strip the field, recompute") is
 *   removed because it produced inconsistent failures depending on the
 *   sender's whitespace / key ordering.
 */

const SIGNATURE_PREFIX = 'sha256=';
const SIGNATURE_HEADER = 'x-webhook-signature';

/**
 * Generates HMAC-SHA256 signature for a payload.
 * Use this function to generate signatures when sending webhooks to external systems.
 * Returns the standard "sha256=<hex>" format.
 *
 * @param payload - The raw request body as a string
 * @param secret  - The shared secret key
 * @returns       - Signature in format "sha256=<hex_digest>"
 */
export function signWebhookPayload(payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload, 'utf8');
  return `${SIGNATURE_PREFIX}${hmac.digest('hex')}`;
}

/**
 * Verifies the webhook signature using HMAC-SHA256.
 *
 * REPARK P0 2026-07-30 — DUAL-MODE:
 *   Some senders compute HMAC over the FULL raw body (with `sign` filled
 *   correctly), others compute HMAC over a body where `sign` has been
 *   stripped (placeholder zeros or omitted entirely). We support both by
 *   computing two candidate HMACs:
 *     candidate 1 — HMAC over the raw body as received (mode B)
 *     candidate 2 — HMAC over a JSON re-serialisation of `rawBody` with
 *                   the `sign` key removed (mode A and the legacy
 *                   "strip-then-verify" path that older clients used)
 *   Whichever matches is accepted; either way the body is the canonical
 *   payload and the signature is 64 lower/upper hex.
 *
 * Security measures:
 * 1. Timing-safe comparison for both candidate checks.
 * 2. Constant-time extraction to prevent signature prefix attacks.
 * 3. Early rejection for missing/invalid headers.
 *
 * @param rawBody          - The raw request body as a string (NOT parsed JSON)
 * @param signatureHeader  - The full value of the X-Webhook-Signature header
 * @param secret           - The shared secret key from WEBHOOK_SECRET env var
 * @returns                - true if signature is valid, false otherwise
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string
): boolean {
  // Reject missing or empty signatures immediately
  if (!signatureHeader || signatureHeader.length === 0) {
    return false;
  }

  // Normalise: strip "sha256=" prefix if present, otherwise treat as plain hex.
  const normalised = signatureHeader.startsWith(SIGNATURE_PREFIX)
    ? signatureHeader.slice(SIGNATURE_PREFIX.length)
    : signatureHeader;

  // Validate: must be exactly 64 lower/upper hex characters (SHA-256)
  if (normalised.length !== 64 || !/^[0-9a-f]{64}$/i.test(normalised)) {
    return false;
  }

  const receivedBuffer = Buffer.from(normalised, 'utf8');

  // Compute both candidate HMACs and compare timing-safely.
  //   candidate 1: HMAC over the raw body as-is (Mode B — `sign` already correct)
  //   candidate 2: HMAC over body with the `sign` key removed (Mode A — pre-filled
  //                zeros / old clients that omit `sign` from the HMAC input)
  let candidate2Body: string | null = null;
  try {
    const parsed = JSON.parse(rawBody);
    if (parsed && typeof parsed === 'object' && 'sign' in parsed) {
      const { sign: _ignored, ...rest } = parsed;
      candidate2Body = JSON.stringify(rest);
    }
  } catch {
    // rawBody isn't JSON → no candidate 2, fall through to raw-only check.
    candidate2Body = null;
  }

  const sig1 = signWebhookPayload(rawBody, secret).slice(SIGNATURE_PREFIX.length);
  const sig2 = candidate2Body !== null
    ? signWebhookPayload(candidate2Body, secret).slice(SIGNATURE_PREFIX.length)
    : null;

  // Timing-safe comparison for candidate 1.
  const buffer1 = Buffer.from(sig1, 'utf8');
  if (buffer1.length === receivedBuffer.length &&
      timingSafeEqual(receivedBuffer, buffer1)) {
    return true;
  }

  // Timing-safe comparison for candidate 2 (mode A / strip-and-verify fallback).
  if (sig2 !== null) {
    const buffer2 = Buffer.from(sig2, 'utf8');
    if (buffer2.length === receivedBuffer.length &&
        timingSafeEqual(receivedBuffer, buffer2)) {
      return true;
    }
  }

  // P0 2026-07-30: short-tag diagnostic on rejection (NEVER log full sigs).
  console.warn(
    `[WEBHOOK] HMAC mismatch on both candidates: received=${normalised.slice(0, 8)}… ` +
    `expected1=${sig1.slice(0, 8)}… expected2=${sig2 ? sig2.slice(0, 8) + '…' : 'n/a'} ` +
    `(body length=${rawBody.length}B; check WEBHOOK_SECRET alignment)`
  );
  return false;
}

/**
 * @deprecated Kept for backward-compat; new code should call
 * {@link verifyWebhookSignature} directly.  This wrapper now always
 * delegates to the main implementation.
 */
export function verifyWebhookSignatureLegacy(
  rawBody: string,
  signatureHeader: string,
  secret: string
): boolean {
  return verifyWebhookSignature(rawBody, signatureHeader, secret);
}

/**
 * Extracts the signature header from request headers object.
 * 
 * @param headers - The headers object from the request
 * @returns      - The signature header value, or empty string if not present
 */
export function getSignatureFromHeaders(headers: Headers): string {
  return headers.get(SIGNATURE_HEADER) ?? '';
}

/**
 * Validates that WEBHOOK_SECRET is configured.
 * Call this at startup or before processing webhooks.
 * 
 * @throws Error if WEBHOOK_SECRET is not set
 */
export function requireWebhookSecret(): string {
  const secret = process.env.WEBHOOK_SECRET;
  
  if (!secret) {
    throw new Error(
      '[WEBHOOK] WEBHOOK_SECRET environment variable is not set. ' +
      'Webhook signature verification cannot proceed without a secret key.'
    );
  }

  if (secret.length < 16) {
    if (process.env.NODE_ENV === 'production' && secret.length < 32) {
      throw new Error('[WEBHOOK] In production, WEBHOOK_SECRET must be at least 32 characters long.');
    }

    console.warn(
      '[WEBHOOK] WARNING: WEBHOOK_SECRET is shorter than 16 characters. ' +
      'Consider using a longer, more secure secret (32+ characters recommended).'
    );
  }

  return secret;
}
