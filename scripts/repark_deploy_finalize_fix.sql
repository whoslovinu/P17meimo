-- ============================================================================
-- REPARK 7.0 (2026-08-24) — Finalize reward migration (production sync)
-- Targets: finalize_activity_milestone_rewards (live RPC)
-- Schema: activity-scoped eligibility via user_activity_stats.total_damage
--         with activity_id filter. Replaces global user_inventory.total_damage_dealt.
-- ============================================================================

-- 1) Rewrite the finalize RPC. CREATE OR REPLACE is idempotent and signature
--    is unchanged, so no DROP is needed. Body now reads user_activity_stats.
CREATE OR REPLACE FUNCTION public.finalize_activity_milestone_rewards(
  p_activity_id BIGINT,
  p_milestones JSONB,
  p_dry_run BOOLEAN DEFAULT FALSE,
  p_finalized_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
)
RETURNS JSONB
LANGUAGE plpgsql
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
      v_claimed_count := v_eligible_count;
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
      'newlyClaimed', v_claimed_count,
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

-- 2) Update the function comment so pg_catalog introspectors see the new semantics.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'finalize_activity_milestone_rewards'
       AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE $cmt$
      COMMENT ON FUNCTION public.finalize_activity_milestone_rewards(
        BIGINT, JSONB, BOOLEAN, TIMESTAMPTZ
      ) IS 'Phase 2: bulk finalizes eligible unclaimed milestone rewards from a normalized milestone JSONB payload; supports dry-run preview mode. REPARK 7.0 (2026-08-24): eligibility is ACTIVITY-SCOPED via user_activity_stats.total_damage WHERE activity_id = p_activity_id — NOT user_inventory.total_damage_dealt.'
    $cmt$;
  END IF;
END$$;

-- 3) Mark the legacy claim RPC as deprecated (still callable but discouraged).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'claim_personal_milestone_reward'
       AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE $cmt$
      COMMENT ON FUNCTION public.claim_personal_milestone_reward(
        UUID, INTEGER, BIGINT, TEXT, TEXT, TIMESTAMPTZ
      ) IS '[DEPRECATED 2026-08-24] Superseded by JS-layer claim paths (app/api/game/milestone/claim + app/api/battle/reward-claim) which read ACTIVITY-SCOPED damage from user_activity_stats. This function still reads GLOBAL user_inventory.total_damage_dealt — DO NOT CALL.'
    $cmt$;
  END IF;
END$$;