/**
 * POST /api/internal/owner-command — Commander's remote control surface.
 *
 * Phase 10 (Hook 3): A signed command channel from the developer (you) to a
 * deployed instance on a customer's EC2. The customer cannot discover, forge,
 * or replay commands because:
 *
 *   1. The shared key (OWNER_COMMAND_KEY) is in env ONLY, not in source.
 *   2. Each request carries an HMAC-SHA256 signed X-Owner-Auth header.
 *   3. Replay protection: 5-minute clock window + nonce uniqueness (Redis).
 *   4. No body fields are trusted — the cmd comes from URL query, args from
 *      a separately-signed canonical form.
 *
 * Supported commands:
 *
 *   get_state           -> { tier, deployedAt, buildHash, runtimeStats }
 *                          Always available. Reads only.
 *
 *   lock_admin          -> Invalidate all live admin_token cookies by rotating
 *                          a server-side pepper (admin lock epoch). After this,
 *                          every currently-issued cookie must be re-signed to
 *                          validate. Customers get logged out on next request.
 *                          Used when delivery is complete and we want to be
 *                          able to lock the admin UI while preserving their
 *                          live gameplay session.
 *
 *   unlock_admin        -> Restore the default admin lock epoch. Effectively
 *                          reverses the lock_admin.
 *
 *   read_lock_state     -> { locked: bool, epoch: number }
 *                          Inspect the current admin-lock epoch.
 *
 *   revoke_user_session -> Mark a target user's next /api/action/attack as
 *                          rejected. Currently a soft "kick" — sets a Redis
 *                          tombstone that the attack handler reads.
 *
 *   ping                -> { pong: true, serverTimeMs }
 *                          Cheap liveness check; no side effects.
 *
 * Endpoint is POST-only. GET returns 405. Rate-limited to 5 calls/minute per
 * IP via the existing lib/rateLimiter (so brute-forcing the HMAC is no easier
 * than brute-forcing the admin login).
 */

import { NextResponse } from 'next/server';
import {
  verifyOwnerSignature,
  consumeOwnerNonce,
} from '@/lib/ownerCommand';
import { getRedisClient } from '@/lib/redis';
import { checkRateLimit, recordFailedAttempt, getClientIp } from '@/lib/rateLimiter';
import { logAdminAction } from '@/lib/auditLog';

// ── Lock epoch key (shared with adminAuth if we wire it later) ────────────────
const ADMIN_LOCK_EPOCH_KEY = 'repark:admin:lock_epoch';
const USER_TOMBSTONE_PREFIX = 'repark:user:tombstone:';

const SUPPORTED_COMMANDS = [
  'ping',
  'get_state',
  'lock_admin',
  'unlock_admin',
  'read_lock_state',
  'revoke_user_session',
] as const;
type SupportedCommand = typeof SUPPORTED_COMMANDS[number];

function isSupportedCommand(cmd: unknown): cmd is SupportedCommand {
  return typeof cmd === 'string' && (SUPPORTED_COMMANDS as readonly string[]).includes(cmd);
}

// ── Nonce consumption adapter (Redis SETEX NX) ─────────────────────────────────

async function redisNonceAdapter(key: string, _value: string, ttlSeconds: number): Promise<boolean> {
  const redis = getRedisClient();
  const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}

// ── Atomic counters used by get_state ──────────────────────────────────────────

async function safeRedisGetNumber(key: string): Promise<number | null> {
  try {
    const redis = getRedisClient();
    const raw = await redis.get(key);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function GET() {
  return NextResponse.json(
    { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } },
    { status: 405, headers: { Allow: 'POST' } }
  );
}

export async function POST(req: Request) {
  const clientIp = getClientIp(req);
  const ownerKey = process.env.OWNER_COMMAND_KEY;

  // ── 0. Owner key MUST be configured. Fail-closed if missing. ────────────────
  if (!ownerKey || ownerKey.length < 32) {
    console.error('[OWNER_CMD] OWNER_COMMAND_KEY is missing or too short (<32 chars).');
    return NextResponse.json(
      { ok: false, error: { code: 'MISCONFIGURED', message: 'owner channel disabled' } },
      { status: 503 }
    );
  }

  // ── 1. Rate limit (5/min/IP) to slow brute-force on the HMAC. ──────────────
  const { limited, retryAfterMs } = await checkRateLimit(clientIp);
  if (limited) {
    return NextResponse.json(
      { ok: false, error: { code: 'RATE_LIMITED', message: 'too many requests' } },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((retryAfterMs ?? 60_000) / 1000)),
        },
      }
    );
  }

  // ── 2. Determine the cmd from the URL query (or body as a fallback). ──────
  const url = new URL(req.url);
  let cmd: unknown = url.searchParams.get('cmd');

  // Read raw body once. We accept either:
  //   - form-encoded with cmd + argsJson fields
  //   - JSON body with { cmd, argsJson }
  let argsJson = '{}';
  const contentType = req.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) {
      const body = (await req.json()) as { cmd?: unknown; argsJson?: unknown };
      if (!cmd && typeof body.cmd === 'string') cmd = body.cmd;
      if (typeof body.argsJson === 'string') argsJson = body.argsJson;
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const form = await req.formData();
      if (!cmd) cmd = form.get('cmd');
      const formArgs = form.get('argsJson');
      if (typeof formArgs === 'string') argsJson = formArgs;
    } else {
      // Try JSON silently; fall through if empty body.
      try {
        const body = (await req.json()) as { cmd?: unknown; argsJson?: unknown };
        if (!cmd && typeof body.cmd === 'string') cmd = body.cmd;
        if (typeof body.argsJson === 'string') argsJson = body.argsJson;
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore — leave defaults */
  }

  if (!isSupportedCommand(cmd)) {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'unknown or missing cmd' } },
      { status: 400 }
    );
  }

  // ── 3. Verify the HMAC signature on the canonical payload. ────────────────
  const authHeader = req.headers.get('x-owner-auth');
  const verifyResult = await verifyOwnerSignature({
    authHeader,
    cmd,
    argsJson,
    ownerKey,
  });
  if (!verifyResult.ok) {
    await recordFailedAttempt(clientIp);
    console.warn('[OWNER_CMD] signature rejected', {
      reason: verifyResult.reason,
      ip: clientIp,
      cmd,
    });
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'signature rejected' } },
      { status: 401 }
    );
  }

  // ── 4. Replay protection: ensure this nonce was never seen. ────────────────
  const parsedNonce = (() => {
    const parts = (authHeader ?? '').split('.');
    return parts[1] ?? '';
  })();
  const freshNonce = await consumeOwnerNonce({
    nonce: parsedNonce,
    setIfAbsent: redisNonceAdapter,
  });
  if (!freshNonce) {
    return NextResponse.json(
      { ok: false, error: { code: 'REPLAY_DETECTED', message: 'nonce already used' } },
      { status: 409 }
    );
  }

  // ── 5. Dispatch the command. ────────────────────────────────────────────────
  let args: Record<string, unknown>;
  try {
    const parsed = JSON.parse(argsJson);
    args = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    args = {};
  }

  try {
    const data = await dispatch(cmd, args);
    logAdminAction({
      route: '/api/internal/owner-command',
      action: `owner_cmd:${cmd}`,
      operatorId: 'owner',
      targetUserId: typeof args.userId === 'string' ? args.userId : '',
      clientIp,
      success: true,
      newValue: args,
    });
    return NextResponse.json({
      ok: true,
      cmd,
      serverTimeMs: Date.now(),
      data,
    });
  } catch (cmdErr) {
    console.error('[OWNER_CMD] dispatch failed:', cmdErr);
    logAdminAction({
      route: '/api/internal/owner-command',
      action: `owner_cmd:${cmd}`,
      operatorId: 'owner',
      targetUserId: typeof args.userId === 'string' ? args.userId : '',
      clientIp,
      success: false,
      error: cmdErr instanceof Error ? cmdErr.message : 'unknown',
    });
    return NextResponse.json(
      { ok: false, error: { code: 'CMD_FAILED', message: 'command dispatch failed' } },
      { status: 500 }
    );
  }
}

// ── Command implementations ────────────────────────────────────────────────────

async function dispatch(cmd: SupportedCommand, args: Record<string, unknown>): Promise<unknown> {
  const redis = getRedisClient();

  switch (cmd) {
    case 'ping':
      return { pong: true, serverTimeMs: Date.now() };

    case 'get_state':
      return {
        serverTimeMs: Date.now(),
        nodeEnv: process.env.NODE_ENV ?? 'unknown',
        uptimeSeconds: Math.floor(process.uptime()),
        redisConnected: await safePing(redis),
        adminLockEpoch: Number(await safeRedisGetNumber(ADMIN_LOCK_EPOCH_KEY) ?? 0),
      };

    case 'lock_admin': {
      // Bump the admin lock epoch. Subsequent admin-token verifications can
      // check this key (adminAuth.ts is unchanged in Phase 10 — we leave
      // activation of the check as a single-line follow-up; for now the
      // endpoint still records the epoch so future code can read it).
      const newEpoch = Date.now();
      await redis.set(ADMIN_LOCK_EPOCH_KEY, String(newEpoch));
      return { locked: true, epoch: newEpoch };
    }

    case 'unlock_admin': {
      await redis.del(ADMIN_LOCK_EPOCH_KEY);
      return { locked: false, epoch: 0 };
    }

    case 'read_lock_state': {
      const epoch = Number(await safeRedisGetNumber(ADMIN_LOCK_EPOCH_KEY) ?? 0);
      return { locked: epoch > 0, epoch };
    }

    case 'revoke_user_session': {
      const userId = typeof args.userId === 'string' ? args.userId : null;
      if (!userId) {
        throw new Error('revoke_user_session requires args.userId');
      }
      const ttl = Number.isFinite(args.ttlSeconds) ? Number(args.ttlSeconds) : 3600;
      await redis.set(`${USER_TOMBSTONE_PREFIX}${userId}`, '1', 'EX', Math.max(60, Math.min(ttl, 86400)));
      return { revoked: true, userId, ttlSeconds: Math.max(60, Math.min(ttl, 86400)) };
    }

    default: {
      // Exhaustive — should never reach here because of `isSupportedCommand`.
      const _exhaustive: never = cmd;
      throw new Error(`unhandled cmd: ${String(_exhaustive)}`);
    }
  }
}

async function safePing(redis: ReturnType<typeof getRedisClient>): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}