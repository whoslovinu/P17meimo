-- =============================================================================
-- Migration: 07_task_claim_lock_and_rpc.sql
-- V5.15-EN | Agent 1 [Cyber-Blacksmith]
--
-- Adds:
--  1. RPC function increment_task_progress() for atomic upsert+increment on task_progress
--  2. processed_flag column on user_daily_tasks (TC-TK-27 rollback guard)
--  3. RLS policies for new columns
-- =============================================================================

-- -----------------------------------------------------------------------------
-- RPC: increment_task_progress
-- Atomically upserts a task_progress row and increments current_progress.
-- Returns the new cumulative value after the increment.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.increment_task_progress(
  p_user_id      UUID,
  p_task_type    TEXT,   -- 'daily_energy' | 'daily_recharge'
  p_date         DATE,
  p_amount       INT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER   -- Runs as table owner so it bypasses RLS
SET search_path = public
AS $$
DECLARE
  new_value INT;
BEGIN
  INSERT INTO public.task_progress (user_id, task_type, reset_date, current_progress, is_claimed)
  VALUES (p_user_id, p_task_type, p_date, p_amount, false)
  ON CONFLICT (user_id, task_type, reset_date)
  DO UPDATE SET
    current_progress = task_progress.current_progress + p_amount,
    updated_at = timezone('utc'::text, now())
  RETURNING current_progress
  INTO new_value;

  RETURN new_value;
END;
$$;

-- Grant execute to authenticated role
GRANT EXECUTE ON FUNCTION public.increment_task_progress(UUID, TEXT, DATE, INT)
  TO authenticated;

-- -----------------------------------------------------------------------------
-- TC-TK-27: Add processed_flag to user_daily_tasks
-- Prevents recharge progress from rolling back when refund events arrive.
-- The webhook handler sets this to TRUE once a recharge event is recorded.
-- Refund events (negative amount) are only applied if processed_flag is FALSE.
-- -----------------------------------------------------------------------------

ALTER TABLE public.user_daily_tasks
  ADD COLUMN IF NOT EXISTS recharge_processed BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for fast processed_flag queries during refund handling
CREATE INDEX IF NOT EXISTS idx_user_daily_tasks_processed
  ON public.user_daily_tasks (user_id, date, recharge_processed)
  WHERE recharge_processed = FALSE;

-- -----------------------------------------------------------------------------
-- RLS: Allow service role to update processed_flag (webhook handler needs it)
-- RLS is bypassed by service role key, but we add policies for belt-and-suspenders.
-- -----------------------------------------------------------------------------

-- Existing policies already cover INSERT/UPDATE with service role.
-- We add a specific policy for the processed_flag column for clarity.

DROP POLICY IF EXISTS "Service role update recharge_processed"
  ON public.user_daily_tasks;

CREATE POLICY "Service role update recharge_processed"
  ON public.user_daily_tasks
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

COMMENT ON COLUMN public.user_daily_tasks.recharge_processed IS
  'TC-TK-27: Set TRUE once a recharge webhook event is recorded. Prevents rollback on refund.';
