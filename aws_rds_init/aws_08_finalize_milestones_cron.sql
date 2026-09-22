-- =============================================================================
-- aws_rds_init / aws_08_finalize_milestones_cron.sql
-- Description: Idempotent registry that records when each activity has been
--              auto-finalized, so the cron handler can dedupe across retries.
--
-- Why this exists:
--   The bulk RPC `public.finalize_activity_milestone_rewards(...)` is itself
--   idempotent (it skips already-claimed rows), but we still want a fast
--   "did we already run finalization for this activity?" check that does NOT
--   have to scan milestone_rewards. This table gives us that.
--
-- Triggered by:  POST /api/internal/cron/finalize-milestones
-- Idempotent:    yes — re-running the cron has no harmful side effect.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.activity_finalization_log (
  activity_id     BIGINT PRIMARY KEY,
  finalized_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  finalized_by    TEXT NOT NULL DEFAULT 'cron:finalize-milestones',
  total_claimed   BIGINT NOT NULL DEFAULT 0,
  result_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_activity_finalization_log_finalized_at
  ON public.activity_finalization_log (finalized_at DESC);