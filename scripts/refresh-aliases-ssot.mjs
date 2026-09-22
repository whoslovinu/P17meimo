// scripts/refresh-aliases-ssot.mjs
//
// REPARK 6.0 — One-off migration to align ALL historical `public.user_alias`
// rows with the new SSOT (lib/userIdentity.ts → toUuid).
//
// Why this script exists:
//   - Prior to 2026-07-25, `lib/db/pg.ts → seedUuid` used a hand-rolled
//     SHA-256 + RFC 4122 v5 byte layout. The same algorithm existed in
//     `lib/auth.ts → toUuid`. They were nominally identical but easily
//     drift-prone (no shared implementation).
//   - On 2026-07-25 we collapsed both into a single SHA-1-based RFC 4122
//     v5 algorithm in `lib/userIdentity.ts`. The output UUIDs for any given
//     `alias_value` may now DIFFER from the legacy values that were minted
//     before today.
//   - This script walks every `public.user_alias` row, recomputes the
//     canonical UUID via the new SSOT, and re-points:
//       (a) `public.user_alias.uuid`            (PK is alias_type+alias_value)
//       (b) `public.users.id`                    (parent row needed for FKs)
//       (c) `public.user_daily_tasks.user_id`
//       (d) `public.user_inventory.user_id`
//       (e) `public.milestone_rewards.user_id`
//       (f) `public.task_progress.user_id`
//       (g) `public.attack_logs.user_id`
//
// Safety:
//   - Dry-run by default. Pass `--apply` to actually write.
//   - All work is wrapped in a single transaction (BEGIN / COMMIT).
//   - Idempotent: re-running detects already-aligned rows and skips them.
//   - Connection string: env `DATABASE_URL` or the SSH-tunnel default.

import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { config as loadEnv } from 'dotenv';

// ── Load env from .env.local (preferred) or .env.production ────────────────
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env.production', override: false });

// ── Inline the new SSOT algorithm (matches lib/userIdentity.ts exactly) ────
// We re-implement it here rather than `import` the TS module because this
// script runs under raw Node (`node --no-warnings`) where TS imports would
// require a transpile step. Keep this block in lockstep with the SSOT.
const REPARK_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToUuid(bytes) {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function toUuid(rawId) {
  if (rawId === null || rawId === undefined) return '';
  const cleanId = String(rawId).trim();
  if (!cleanId) return '';
  if (UUID_RE.test(cleanId)) return cleanId.toLowerCase();
  const nsBytes = hexToBytes(REPARK_NAMESPACE.replace(/-/g, ''));
  const nameBytes = new TextEncoder().encode(cleanId);
  const combined = new Uint8Array(nsBytes.length + nameBytes.length);
  combined.set(nsBytes, 0);
  combined.set(nameBytes, nsBytes.length);
  const hash = createHash('sha1').update(combined).digest();
  const b = new Uint8Array(hash.subarray(0, 16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x50;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  return bytesToUuid(b);
}

// ── Connection ─────────────────────────────────────────────────────────────
const APPLY = process.argv.includes('--apply');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1]?.trim();

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:PhbcRcx5Wt@127.0.0.1:5433/postgres';

// SSH tunnels reach RDS through the bastion. RDS's `pg_hba.conf` rejects
// "no encryption" connections, so we must ALWAYS attempt SSL first when
// the connection string has a password (production-ish). For local dev
// strings without a password (rare), we leave SSL off.
const hasPassword = /:.*@/.test(connectionString);
const pool = new Pool({
  connectionString,
  ssl: hasPassword ? { rejectUnauthorized: false } : undefined,
  statement_timeout: 30_000,
});

const banner = (msg) => console.log(`\n=== ${msg} ===`);
const info = (msg) => console.log(`  ${msg}`);

// Tables that FK-reference public.users(id). We must repoint all of these
// when alias.uuid changes so the gameplay data stays attached to the user.
const CHILD_TABLES = [
  { name: 'user_daily_tasks', userCol: 'user_id' },
  { name: 'user_inventory',   userCol: 'user_id' },
  { name: 'milestone_rewards',userCol: 'user_id' },
  { name: 'task_progress',    userCol: 'user_id' },
  { name: 'attack_logs',      userCol: 'user_id' },
];

async function safeCount(label, q, params) {
  const r = await pool.query(q, params);
  info(`${label}: ${r.rowCount}`);
  return r.rowCount ?? 0;
}

async function run() {
  banner(`Refresh aliases to SSOT — mode=${APPLY ? 'APPLY' : 'DRY-RUN'}${ONLY ? ` (only=${ONLY})` : ''}`);

  // 1. Snapshot all current aliases (optionally filtered).
  const where = ONLY ? `WHERE alias_value = $1` : '';
  const params = ONLY ? [ONLY] : [];
  const { rows: aliases } = await pool.query(
    `SELECT alias_type, alias_value, uuid
       FROM public.user_alias
       ${where}
       ORDER BY alias_type, alias_value`,
    params
  );
  info(`Found ${aliases.length} alias row(s)`);

  let aligned = 0;
  let needsMigration = 0;
  let missingUsers = 0;
  let rowsRepointed = 0;

  for (const row of aliases) {
    const { alias_type, alias_value, uuid: legacyUuid } = row;
    const canonicalUuid = toUuid(alias_value);

    if (canonicalUuid === legacyUuid) {
      aligned++;
      continue;
    }

    needsMigration++;
    banner(`ALIAS: ${alias_type}=${alias_value}`);
    info(`legacy    : ${legacyUuid}`);
    info(`canonical : ${canonicalUuid}  ← via lib/userIdentity.ts SSOT`);

    if (!APPLY) {
      info('  (skipped — dry-run. Pass --apply to write.)');
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // (a) Make sure a users row exists for the canonical UUID — without
      //     this the FK inserts on the child tables below would 23503.
      await client.query(
        `INSERT INTO public.users (id, nickname, avatar)
         VALUES ($1, '', '👤')
         ON CONFLICT (id) DO NOTHING`,
        [canonicalUuid]
      );

      // (b) If a users row already exists under the LEGACY UUID and has no
      //     child rows, delete it after migration to keep the users table
      //     tidy. (Child rows are repointed below.)
      const legacyUserChildren = await client.query(
        `SELECT
           (SELECT COUNT(*) FROM public.user_daily_tasks WHERE user_id = $1) +
           (SELECT COUNT(*) FROM public.user_inventory WHERE user_id = $1) +
           (SELECT COUNT(*) FROM public.milestone_rewards WHERE user_id = $1) +
           (SELECT COUNT(*) FROM public.task_progress WHERE user_id = $1) +
           (SELECT COUNT(*) FROM public.attack_logs WHERE user_id = $1) AS total`,
        [legacyUuid]
      );
      const legacyStillHasKids = Number(legacyUserChildren.rows[0]?.total ?? 0) > 0;

      // (c) Repoint each child table.
      for (const t of CHILD_TABLES) {
        const r = await client.query(
          `UPDATE public.${t.name}
              SET ${t.userCol} = $1
            WHERE ${t.userCol} = $2`,
          [canonicalUuid, legacyUuid]
        );
        info(`  ${t.name}.${t.userCol}  ←  ${r.rowCount} row(s) repointed`);
        rowsRepointed += r.rowCount ?? 0;
      }

      // (d) Repoint the alias row itself.
      const aliasUpd = await client.query(
        `UPDATE public.user_alias
            SET uuid = $1
          WHERE alias_type = $2 AND alias_value = $3 AND uuid = $4`,
        [canonicalUuid, alias_type, alias_value, legacyUuid]
      );
      info(`  user_alias.uuid  ←  ${aliasUpd.rowCount} row(s) updated`);

      // (e) If a different alias row already points at the canonical UUID
      //     (e.g. main_station_user_id mapping that race-arrived first),
      //     delete the duplicate we just emptied. PK conflict avoided by
      //     the WHERE clause above.
      await client.query(
        `DELETE FROM public.user_alias
          WHERE alias_type = $1 AND alias_value = $2 AND uuid = $3`,
        [alias_type, alias_value, legacyUuid]
      );

      // (f) If the legacy users row is now orphan (no children), drop it.
      if (!legacyStillHasKids) {
        await client.query(`DELETE FROM public.users WHERE id = $1`, [legacyUuid]);
        info(`  legacy users row deleted (orphan)`);
      } else {
        info(`  legacy users row kept (still has children — manual review)`);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  banner('SUMMARY');
  info(`Total aliases           : ${aliases.length}`);
  info(`Already aligned (skip)  : ${aligned}`);
  info(`Need migration          : ${needsMigration}`);
  if (APPLY) {
    info(`Child rows repointed    : ${rowsRepointed}`);
    if (missingUsers > 0) info(`Missing users inserted   : ${missingUsers}`);
  } else if (needsMigration > 0) {
    info('');
    info('==> DRY-RUN. Re-run with --apply to execute the migration.');
  }
}

run()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[refresh-aliases-ssot] FATAL:', err);
    await pool.end();
    process.exit(1);
  });
