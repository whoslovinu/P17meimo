-- ═══════════════════════════════════════════════════════════════════════════════
-- 15 — public.webhook_audit
--     Persistent audit trail for webhook events received from Main Station.
--     Replaces (and augments) the previous stderr-only console log so we can
--     query the full history of webhook deliveries by tx_id, user, action, or
--     result — critical for diagnosing customer-reported issues without having
--     to SSH into the server and grep PM2 logs.
--
-- Schema mirrors `admin_audit_log` (LB-06) for consistency:
--   - Append-only (no UPDATE / DELETE in app code)
--   - Composite indexes for the most common query patterns
--   - RLS enabled; only service_role can read/write
--
-- Execution:
--   1. Run via: node scripts/deploy_aws_db.mjs   (uses the local SSH tunnel)
--      Or directly: psql "$DATABASE_URL" -f this_file.sql
--   2. Verify:   SELECT count(*) FROM public.webhook_audit;
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. CREATE TABLE ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.webhook_audit (
  id           BIGSERIAL PRIMARY KEY,
  -- Request correlation
  tx_id        TEXT,                                -- nullable: failed at parse stage before we knew tx_id
  action_type  TEXT,                                -- 'consume' | 'recharge' | 'UNKNOWN'
  -- User identification (canonical UUID + raw input we received)
  user_id      TEXT,                                -- resolved canonical UUID (NULL on early failures)
  raw_user_id  TEXT,                                -- original user_id from payload (POST-decoded)
  -- Request metadata
  client_ip    TEXT,
  duration_ms  INTEGER,
  http_status  INTEGER,                             -- 200 / 401 / 400 / 500
  success      BOOLEAN NOT NULL DEFAULT false,
  result       TEXT,                                -- 'success' | 'duplicate' | 'refund-blocked' | (free text)
  error_code   TEXT,                                -- 'INVALID_HMAC' | 'MALFORMED_JSON' | 'SCHEMA_FAIL' | 'DB_FAIL' | 'ALIAS_TIMEOUT' | null
  error_message TEXT,
  raw_body     TEXT,                                -- only on failure; capped to 8KB to avoid runaway growth
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. ROW-LEVEL SECURITY ────────────────────────────────────────────────────
--
-- Note: on AWS RDS the `service_role` Postgres role from Supabase does NOT
-- exist, so we don't enable RLS here. Access is gated at the application
-- layer (only the Next.js server uses the connection pool). If a future
-- migration moves the DB behind a multi-tenant VPS, add RLS back and create
-- the role first: CREATE ROLE service_role NOLOGIN;

-- ── 3. INDEXES ───────────────────────────────────────────────────────────────

-- By tx_id (most common: customer reports a tx_id and we want its full lifecycle)
CREATE INDEX IF NOT EXISTS idx_webhook_audit_tx_id
  ON public.webhook_audit (tx_id)
  WHERE tx_id IS NOT NULL;

-- By canonical user_id (drill into a user's recent webhook history)
CREATE INDEX IF NOT EXISTS idx_webhook_audit_user_id
  ON public.webhook_audit (user_id)
  WHERE user_id IS NOT NULL;

-- By raw_user_id (see what came in before alias resolution, useful when alias
-- mapping changes and we want to see who used what external id)
CREATE INDEX IF NOT EXISTS idx_webhook_audit_raw_user_id
  ON public.webhook_audit (raw_user_id)
  WHERE raw_user_id IS NOT NULL;

-- By time range (default for dashboards / "last hour of failures")
CREATE INDEX IF NOT EXISTS idx_webhook_audit_created_at
  ON public.webhook_audit (created_at DESC);

-- Composite: user + time
CREATE INDEX IF NOT EXISTS idx_webhook_audit_user_time
  ON public.webhook_audit (user_id, created_at DESC);

-- By success/failure (alerting on error spikes)
CREATE INDEX IF NOT EXISTS idx_webhook_audit_success_time
  ON public.webhook_audit (success, created_at DESC)
  WHERE success = false;

-- ── 4. RETENTION NOTE (informational only) ───────────────────────────────────
-- We do NOT add a DELETE policy in this migration. Webhook volume is low
-- (hundreds/day at peak). If this ever becomes a hot table, rotate monthly
-- via a cron job:   DELETE FROM public.webhook_audit WHERE created_at < NOW() - INTERVAL '90 days';

COMMIT;
