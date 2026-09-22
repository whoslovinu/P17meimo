-- =============================================================================
-- aws_rds_init / aws_07_fix_updated_at_columns.sql
-- Description: Defensive backfill for tables that the live code writes
--              `updated_at = now()` against. On a DB that was bootstrapped
--              with aws_01..aws_06 (which DID declare updated_at on
--              user_daily_tasks and task_progress), this is a no-op. On
--              any DB where the original CREATE TABLE was run without
--              updated_at (e.g. legacy Supabase import), this restores
--              the column without dropping data.
--
-- Idempotent. Safe to re-run.
-- =============================================================================

ALTER TABLE public.user_daily_tasks
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
    NOT NULL DEFAULT timezone('utc'::text, now());

ALTER TABLE public.task_progress
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
    NOT NULL DEFAULT timezone('utc'::text, now());

-- Trigger function should already exist from aws_03_functions.sql; recreate
-- defensively so this migration is self-contained.
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

DROP TRIGGER IF EXISTS update_task_progress_updated_at
  ON public.task_progress;
CREATE TRIGGER update_task_progress_updated_at
  BEFORE UPDATE ON public.task_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();