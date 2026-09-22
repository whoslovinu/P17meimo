-- =============================================================================
-- Migration: 11_webhook_atomic_rpc.sql
-- V5.16-EN | Agent 1 [Cyber-Blacksmith]
--
-- Purpose: Provides the atomic RPC for user_daily_tasks increment.
-- The webhook route (app/api/webhook/user-action/route.ts) MUST use this RPC
-- instead of read-then-write to prevent race conditions on concurrent webhook
-- deliveries with the same tx_id bypassed by the Redis idempotency gate.
--
-- The existing increment_task_progress() RPC handles task_progress table only.
-- This new RPC handles user_daily_tasks accumulation.
-- =============================================================================

-- ── RPC: increment_user_daily_task ─────────────────────────────────────────────
-- Atomically upserts a user_daily_tasks row and increments the specified field.
-- Returns the new cumulative value after the increment.
--
-- Args:
--   p_user_id      UUID       — user identifier
--   p_date         DATE       — reset date (YYYY-MM-DD, UTC+8)
--   p_field        TEXT       — 'consume' | 'recharge'
--   p_amount       INT        — amount to add (positive)
--   p_recharged    BOOLEAN    — if TRUE, also set recharge_processed = TRUE
--
-- Returns: INT — new cumulative value for the incremented field

CREATE OR REPLACE FUNCTION public.increment_user_daily_task(
  p_user_id    UUID,
  p_date       DATE,
  p_field      TEXT,     -- 'consume' | 'recharge'
  p_amount     INT,
  p_recharged  BOOLEAN   DEFAULT FALSE
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_val INT;
BEGIN
  IF p_field = 'consume' THEN
    INSERT INTO public.user_daily_tasks
      (user_id, date, daily_energy_consumed, daily_money_recharged)
    VALUES
      (p_user_id, p_date, p_amount, 0)
    ON CONFLICT (user_id, date)
    DO UPDATE SET
      daily_energy_consumed = user_daily_tasks.daily_energy_consumed + p_amount,
      updated_at = timezone('utc'::text, now())
    RETURNING daily_energy_consumed
    INTO new_val;

  ELSIF p_field = 'recharge' THEN
    INSERT INTO public.user_daily_tasks
      (user_id, date, daily_energy_consumed, daily_money_recharged, recharge_processed)
    VALUES
      (p_user_id, p_date, 0, p_amount, p_recharged)
    ON CONFLICT (user_id, date)
    DO UPDATE SET
      daily_money_recharged = user_daily_tasks.daily_money_recharged + p_amount,
      recharge_processed   = user_daily_tasks.recharge_processed OR p_recharged,
      updated_at           = timezone('utc'::text, now())
    RETURNING daily_money_recharged
    INTO new_val;
  ELSE
    -- Invalid field — return 0
    RETURN 0;
  END IF;

  RETURN COALESCE(new_val, 0);
END;
$$;

-- Grant execute to authenticated role (webhook uses service role key, so this is belt-and-suspenders)
GRANT EXECUTE ON FUNCTION public.increment_user_daily_task(UUID, DATE, TEXT, INT, BOOLEAN)
  TO authenticated;

-- Comment
COMMENT ON FUNCTION public.increment_user_daily_task IS
  'Atomically increments consume/recharge in user_daily_tasks. Used by webhook handler. Idempotent via Redis tx_id gate.';
