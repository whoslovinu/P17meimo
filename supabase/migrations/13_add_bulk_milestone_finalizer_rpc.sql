-- =============================================================================
-- Migration: 13_add_bulk_milestone_finalizer_rpc.sql
--
-- Phase 2: Admin-triggered bulk milestone finalization engine.
--
-- ⚠️ REPARK 7.0 (2026-08-24): Eligibility is now ACTIVITY-SCOPED. The CTE
-- `eligible` reads from user_activity_stats WHERE activity_id = p_activity_id,
-- NOT user_inventory.total_damage_dealt. Without this scope, a player with
-- large lifetime damage but low current-activity damage would falsely unlock
-- milestones from prior activities.
--
-- Adds:
--   public.finalize_activity_milestone_rewards(
--     p_activity_id BIGINT,
--     p_milestones JSONB,
--     p_dry_run BOOLEAN DEFAULT FALSE,
--     p_finalized_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
--   )
--
-- Guarantees:
--   1. SQL-side loop only over milestone definitions, never users in app code
--   2. Set-based eligible selection with WITH eligible AS (...)
--   3. Atomic milestone claim writes + reward grants inside the function transaction
--   4. Idempotent repeated execution
--   5. Dry-run mode returns counts without mutating data
-- =============================================================================

DROP FUNCTION IF EXISTS public.finalize_activity_milestone_rewards(BIGINT, JSONB, BOOLEAN, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.finalize_activity_milestone_rewards(
  p_activity_id  BIGINT,
  p_milestones   JSONB,
  p_dry_run      BOOLEAN DEFAULT FALSE,
  p_finalized_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m JSONB;
  v_milestone_id INTEGER;
  v_threshold BIGINT;
  v_reward_type TEXT;
  v_reward_value TEXT;
  v_eligible_count INTEGER;
  v_claimed_count INTEGER;
  v_result JSONB := '[]'::jsonb;
  v_summary JSONB;
BEGIN
  IF jsonb_typeof(p_milestones) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_MILESTONES_PAYLOAD';
  END IF;

  FOR m IN SELECT * FROM jsonb_array_elements(p_milestones)
  LOOP
    v_milestone_id := NULLIF(m->>'id', '')::INTEGER;
    v_threshold := NULLIF(m->>'threshold', '')::BIGINT;
    v_reward_type := m->>'rewardType';
    v_reward_value := COALESCE(m->>'rewardValue', '');

    IF v_milestone_id IS NULL OR v_threshold IS NULL OR v_threshold < 0 THEN
      RAISE EXCEPTION 'INVALID_MILESTONE_ROW';
    END IF;

    IF v_reward_type NOT IN ('ENERGY', 'MEDAL') THEN
      RAISE EXCEPTION 'INVALID_REWARD_TYPE';
    END IF;

    -- REPARK 7.0 (2026-08-24): Eligibility is ACTIVITY-SCOPED — only players
  -- whose damage in THIS activity (user_activity_stats.total_damage WHERE
  -- activity_id = p_activity_id) meets the threshold qualify. The previous
  -- query read user_inventory.total_damage_dealt (global), which falsely
  -- granted rewards based on prior activities.
  WITH eligible AS (
    SELECT uas.user_id
      FROM public.user_activity_stats uas
      LEFT JOIN public.milestone_rewards mr
        ON mr.user_id = uas.user_id
       AND mr.milestone_id = v_milestone_id
     WHERE uas.activity_id = p_activity_id
       AND uas.total_damage >= v_threshold
       AND (mr.user_id IS NULL OR mr.is_claimed = FALSE)
       AND COALESCE(mr.is_locked, FALSE) = FALSE
  )
  SELECT COUNT(*) INTO v_eligible_count FROM eligible;

  IF p_dry_run THEN
    v_claimed_count := 0;
  ELSE
    WITH eligible AS (
      SELECT uas.user_id
        FROM public.user_activity_stats uas
        LEFT JOIN public.milestone_rewards mr
          ON mr.user_id = uas.user_id
         AND mr.milestone_id = v_milestone_id
       WHERE uas.activity_id = p_activity_id
         AND uas.total_damage >= v_threshold
         AND (mr.user_id IS NULL OR mr.is_claimed = FALSE)
         AND COALESCE(mr.is_locked, FALSE) = FALSE
    ), claimed AS (
        INSERT INTO public.milestone_rewards (
          user_id,
          milestone_id,
          is_claimed,
          claimed_at,
          reward_type,
          reward_value,
          is_locked
        )
        SELECT
          e.user_id,
          v_milestone_id,
          TRUE,
          p_finalized_at,
          v_reward_type,
          v_reward_value,
          FALSE
        FROM eligible e
        ON CONFLICT (user_id, milestone_id)
        DO UPDATE SET
          is_claimed = TRUE,
          claimed_at = EXCLUDED.claimed_at,
          reward_type = EXCLUDED.reward_type,
          reward_value = EXCLUDED.reward_value
        WHERE public.milestone_rewards.is_claimed = FALSE
          AND COALESCE(public.milestone_rewards.is_locked, FALSE) = FALSE
        RETURNING user_id
      ), energy_grant AS (
        UPDATE public.user_inventory ui
        SET item_hand_count = ui.item_hand_count + 1,
            updated_at = timezone('utc'::text, now())
        FROM claimed c
        WHERE v_reward_type = 'ENERGY'
          AND ui.user_id = c.user_id
        RETURNING ui.user_id
      )
      SELECT COUNT(*) INTO v_claimed_count FROM claimed;
    END IF;

    v_summary := jsonb_build_object(
      'activityId', p_activity_id,
      'milestoneId', v_milestone_id,
      'threshold', v_threshold,
      'rewardType', v_reward_type,
      'rewardValue', v_reward_value,
      'eligibleUsers', v_eligible_count,
      'newlyClaimed', CASE WHEN p_dry_run THEN v_eligible_count ELSE v_claimed_count END,
      'dryRun', p_dry_run
    );

    v_result := v_result || jsonb_build_array(v_summary);
  END LOOP;

  RETURN jsonb_build_object(
    'activityId', p_activity_id,
    'dryRun', p_dry_run,
    'finalizedAt', p_finalized_at,
    'milestones', v_result
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_activity_milestone_rewards(BIGINT, JSONB, BOOLEAN, TIMESTAMPTZ)
  TO authenticated;

COMMENT ON FUNCTION public.finalize_activity_milestone_rewards IS
  'Phase 2: bulk finalizes eligible unclaimed milestone rewards from a normalized milestone JSONB payload; supports dry-run preview mode. REPARK 7.0 (2026-08-24): eligibility is ACTIVITY-SCOPED via user_activity_stats.total_damage WHERE activity_id = p_activity_id — NOT user_inventory.total_damage_dealt.';
