-- =============================================================================
-- Migration: 14_fix_user_daily_tasks_updated_at.sql
-- Description: Add `updated_at` column to user_daily_tasks (and backfill
--              task_progress if missing) so increment_user_daily_task RPC
--              (defined in 11_webhook_atomic_rpc.sql) can run without
--              raising 42703 (column does not exist).
--
-- Root cause: 01_task_inventory_schema.sql declared user_daily_tasks with
-- only 5 columns (user_id, date, daily_energy_consumed,
-- daily_money_recharged) but did not include updated_at. RPC 11 writes
-- `updated_at = now()` on every UPDATE/INSERT, which crashed on fresh
-- databases.
--
-- This migration is IDEMPOTENT — safe to re-run after partial application.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. user_daily_tasks — add updated_at + trigger if missing
-- -----------------------------------------------------------------------------
ALTER TABLE public.user_daily_tasks
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
    NOT NULL DEFAULT timezone('utc'::text, now());

-- Reuse the universal trigger function from 02_battle_system_schema.sql
-- (defined as update_updated_at_column() — also recreated here as a
-- defensive no-op in case 02 was not applied first).
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_user_daily_tasks_updated_at
  ON public.user_daily_tasks;
CREATE TRIGGER update_user_daily_tasks_updated_at
  BEFORE UPDATE ON public.user_daily_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- 2. task_progress — defensive backfill (02_battle_system_schema.sql SHOULD
--    have created it, but if migration order is wrong on a fresh DB this
--    fixes 42703 on any code path that writes task_progress.updated_at).
-- -----------------------------------------------------------------------------
ALTER TABLE public.task_progress
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
    NOT NULL DEFAULT timezone('utc'::text, now());

DROP TRIGGER IF EXISTS update_task_progress_updated_at
  ON public.task_progress;
CREATE TRIGGER update_task_progress_updated_at
  BEFORE UPDATE ON public.task_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- 3. Verification — exit non-zero if the RPC's required column is still gone
--    (lets the SQL injector fail loudly instead of letting the bug surface at
--    first webhook delivery).
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'user_daily_tasks'
      AND column_name  = 'updated_at'
  ) THEN
    RAISE EXCEPTION 'Migration 14 verification FAILED: user_daily_tasks.updated_at still missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'task_progress'
      AND column_name  = 'updated_at'
  ) THEN
    RAISE EXCEPTION 'Migration 14 verification FAILED: task_progress.updated_at still missing';
  END IF;

  RAISE NOTICE 'Migration 14 OK: updated_at columns present on user_daily_tasks + task_progress';
END
$$;