-- =============================================================================
-- Migration: 08_activity_cleanup_and_reset.sql
-- V5.15-EN | Agent 1 [Cyber-Blacksmith]
--
-- TC-TK-29: Force-clear all unused items when activity_end_time is reached.
--
-- This migration creates:
--  1. pg_cron job to call clear_expired_items() at midnight UTC+8.
--  2. RPC function clear_expired_items() that deletes unused items from
--     user_inventory when the current active activity has ended.
--  3. Optional: daily task reset at midnight UTC+8.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- RPC: clear_expired_items
-- Deletes all unused attack items from user_inventory when the active
-- activity's end_time has passed (UTC+8).
--
-- Returns: number of users affected.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.clear_expired_items()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_users INT;
  current_activity_end TIMESTAMPTZ;
BEGIN
  -- Find the currently-active activity's end time
  SELECT end_time::TIMESTAMPTZ INTO current_activity_end
  FROM public.activities
  WHERE config->>'isGlobalEnabled' = 'true'
  LIMIT 1;

  -- If no active activity, exit early
  IF current_activity_end IS NULL THEN
    RAISE NOTICE 'clear_expired_items: No active activity found, skipping';
    RETURN 0;
  END IF;

  -- Check if the activity has ended (using Asia/Shanghai timezone)
  IF current_activity_end <= (NOW() AT TIME ZONE 'Asia/Shanghai') THEN
    -- Clear all item counts to zero for all users
    UPDATE public.user_inventory
    SET item_hand_count = 0,
        item_phallus_count = 0,
        updated_at = NOW()
    WHERE item_hand_count > 0 OR item_phallus_count > 0;

    GET DIAGNOSTICS affected_users = ROW_COUNT;
    RAISE NOTICE 'clear_expired_items: Cleared items for % users at activity end', affected_users;
    RETURN affected_users;
  ELSE
    RAISE NOTICE 'clear_expired_items: Activity still active (ends at %), skipping', current_activity_end;
    RETURN 0;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_expired_items() TO SERVICE_ROLE, authenticated;

-- -----------------------------------------------------------------------------
-- RPC: reset_daily_tasks_for_date
-- Resets is_claimed flag for all users on a given date.
-- Called by pg_cron at midnight UTC+8.
--
-- In the task_progress table, we use reset_date as the partition key.
-- Old rows (reset_date < today) can optionally be archived/deleted.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reset_daily_tasks()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_rows INT;
BEGIN
  -- Mark all tasks for yesterday as claimed to prevent retroactive claims.
  -- This is a belt-and-suspenders approach since tasks are keyed by reset_date.
  UPDATE public.task_progress
  SET is_claimed = true
  WHERE is_claimed = false
    AND reset_date < CURRENT_DATE AT TIME ZONE 'Asia/Shanghai';

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RAISE NOTICE 'reset_daily_tasks: Marked % rows as claimed', affected_rows;
  RETURN affected_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_daily_tasks() TO SERVICE_ROLE, authenticated;

-- -----------------------------------------------------------------------------
-- pg_cron: Schedule cleanup jobs (UTC+8 = UTC+8, so cron runs at 16:00 UTC)
-- For midnight UTC+8: cron expression = '0 16 * * *'
-- For pg_cron, times are in UTC. 00:00 UTC+8 = 16:00 UTC previous day.
-- -----------------------------------------------------------------------------

-- Daily task reset at 16:00 UTC (= 00:00 UTC+8)
SELECT cron.schedule(
  'daily-task-reset-utc8',
  '0 16 * * *',
  'SELECT public.reset_daily_tasks()'
);

-- Activity item cleanup at 16:00 UTC (= 00:00 UTC+8)
SELECT cron.schedule(
  'activity-item-cleanup-utc8',
  '0 16 * * *',
  'SELECT public.clear_expired_items()'
);

COMMENT ON FUNCTION public.clear_expired_items() IS
  'TC-TK-29: Clears unused items when activity ends. Called by pg_cron at 00:00 UTC+8.';

COMMENT ON FUNCTION public.reset_daily_tasks() IS
  'TC-TK-06: Marks yesterday tasks as claimed at midnight UTC+8 to prevent retroactive claims.';
