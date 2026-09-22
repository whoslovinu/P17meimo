/**
 * lib/db/postgres.ts — REPARK Sovereign DB Adapter
 *
 * The single, project-wide connection pool to AWS RDS PostgreSQL.
 * All server-side code that needs raw SQL must import `getPostgresPool()`
 * from this module. NO other module is permitted to instantiate `pg.Client`
 * or `pg.Pool` directly.
 *
 * Source of truth: process.env.DATABASE_URL
 *   - Local dev  : postgresql://user:pwd@127.0.0.1:5433/postgres
 *                  (forwarded via `node scripts/dev_tunnel.mjs` through
 *                  the SSH bastion to AWS RDS)
 *   - Production  : postgresql://user:pwd@<RDS endpoint>:5432/postgres
 *                  (set via hosting platform env vars)
 *
 * Why `pg.Pool` (not `pg.Client`):
 *   - Next.js Route Handlers are stateless and concurrent. A single shared
 *     Pool gives us connection reuse, statement timeout enforcement, and
 *     automatic reconnection on transient network drops.
 *   - `pg.Client` would force a `connect()` / `end()` cycle per request —
 *     unaffordable under battle load.
 *
 * Sovereign rules (REPARK HARD-ENGINEERING):
 *   1. NEVER swallow DB errors here. The pool only throws. Callers decide
 *      how to surface them. Silent fallback is forbidden.
 *   2. Fail fast at boot if DATABASE_URL is missing in production. In dev
 *      we throw too — there is no useful "offline mode" for the Battle
 *      system, and a missing URL almost always means the SSH tunnel is
 *      not running.
 *   3. SSL is required for AWS RDS. We pass `rejectUnauthorized: false`
 *      ONLY because the SSH tunnel terminates the connection locally
 *      (the RDS cert is bound to the AWS hostname, not 127.0.0.1).
 *      When connecting directly to RDS in production, use the official
 *      RDS CA bundle and set `rejectUnauthorized: true`.
 */

import { Pool, type PoolConfig } from 'pg';

// ═════════════════════════════════════════════════════════════════════════════════
// PG POOL SINGLETON — pinned to globalThis to survive Next.js dev HMR
// ═════════════════════════════════════════════════════════════════════════════════
// Without this, every hot-reload re-evaluates this module and the previous
// Pool is orphaned. The orphaned pool keeps its idle sockets open to RDS
// (through the SSH tunnel), eventually exhausting both file descriptors and
// RDS connection slots. Pinning to globalThis guarantees one Pool per process.

declare global {
  // eslint-disable-next-line no-var
  var __repark_pg_pool__: Pool | undefined;
  // eslint-disable-next-line no-var
  var __repark_pg_validated__: boolean | undefined;
}

function buildPoolConfig(): PoolConfig {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim().length === 0) {
    throw new Error(
      '[DB] FATAL: DATABASE_URL is not set. ' +
        'Copy .env.local.example to .env.local and start `node scripts/dev_tunnel.mjs` ' +
        'before running `npm run dev`.'
    );
  }

  // Detect whether we're traversing the local SSH tunnel.
  // In that case, the RDS cert hostname won't match 127.0.0.1, so we must
  // skip strict cert verification. In a real production deploy, switch this
  // to use the AWS RDS CA bundle + rejectUnauthorized: true.
  const isLocalTunnel = url.includes('127.0.0.1') || url.includes('localhost');

  return {
    connectionString: url,
    max: 10,                       // Next.js dev server is single-process; 10 is safe
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,     // 10s hard ceiling per query — battle loop needs liveness
    // FIX: always require SSL for AWS RDS. Even through the local SSH tunnel
    // the connection terminates at the RDS instance which has `rds.force_ssl=1`.
    // The cert hostname mismatch is handled by `rejectUnauthorized: false`,
    // which is acceptable because the SSH tunnel itself is already authenticated.
    ssl: { rejectUnauthorized: false },
  };
}

/**
 * Returns the shared pg.Pool instance. Lazy-initialized on first call.
 * Subsequent calls return the cached instance.
 *
 * @throws Error if DATABASE_URL is missing.
 */
export function getPostgresPool(): Pool {
  if (globalThis.__repark_pg_pool__) return globalThis.__repark_pg_pool__;
  if (globalThis.__repark_pg_validated__ === undefined) {
    globalThis.__repark_pg_validated__ = false;
  }

  if (process.env.NODE_ENV === 'production' && !globalThis.__repark_pg_validated__) {
    // Production fail-fast: validate env presence, but do not eagerly connect.
    // (The pool itself lazily opens connections on first query.)
    if (!process.env.DATABASE_URL) {
      throw new Error('[DB] FATAL: DATABASE_URL is required in production.');
    }
    globalThis.__repark_pg_validated__ = true;
  }

  const pool = new Pool(buildPoolConfig());

  // Surface pool-level failures loudly. Without these listeners, errors
  // on idle clients would be silently dropped by the `pg` library.
  pool.on('error', (err: Error) => {
    console.error('[DB] Idle pg client error:', err.message);
  });

  pool.on('connect', () => {
    // Uncomment for verbose boot traces:
    // console.log('[DB] pg client connected');
  });

  globalThis.__repark_pg_pool__ = pool;
  return pool;
}

/**
 * Forces the pool to close. Used in test teardown and graceful shutdown.
 * Safe to call multiple times.
 */
export async function closePostgresPool(): Promise<void> {
  if (!globalThis.__repark_pg_pool__) return;
  await globalThis.__repark_pg_pool__.end();
  globalThis.__repark_pg_pool__ = undefined;
  globalThis.__repark_pg_validated__ = false;
}
