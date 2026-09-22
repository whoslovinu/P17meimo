CREATE OR REPLACE FUNCTION public.increment_boss_version(target_boss_id UUID)
RETURNS INTEGER AS $$
DECLARE
  new_version INTEGER;
BEGIN
  UPDATE public.boss_status
  SET version = version + 1,
      last_updated_at = timezone('utc'::text, now())
  WHERE boss_id = target_boss_id
  RETURNING version INTO new_version;

  RETURN new_version;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.add_user_damage(p_user_id UUID, p_damage BIGINT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.user_inventory (user_id, item_hand_count, item_phallus_count, total_damage_dealt)
  VALUES (p_user_id, 0, 0, p_damage)
  ON CONFLICT (user_id)
  DO UPDATE SET
    total_damage_dealt = public.user_inventory.total_damage_dealt + p_damage,
    updated_at = timezone('utc'::text, now());
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.increment_item_count(
  p_user_id UUID,
  p_item_type TEXT,
  p_amount INTEGER DEFAULT 1
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.user_inventory (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  IF p_item_type = 'item_hand' THEN
    UPDATE public.user_inventory
    SET item_hand_count = item_hand_count + p_amount,
        updated_at = timezone('utc'::text, now())
    WHERE user_id = p_user_id;
  ELSIF p_item_type = 'item_phallus' THEN
    UPDATE public.user_inventory
    SET item_phallus_count = item_phallus_count + p_amount,
        updated_at = timezone('utc'::text, now())
    WHERE user_id = p_user_id;
  ELSE
    RAISE EXCEPTION 'INVALID_ITEM_TYPE';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.increment_task_progress(
  p_user_id UUID,
  p_task_type TEXT,
  p_date DATE,
  p_amount INT
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  new_value INT;
BEGIN
  INSERT INTO public.task_progress (user_id, task_type, reset_date, current_progress, is_claimed)
  VALUES (p_user_id, p_task_type, p_date, p_amount, false)
  ON CONFLICT (user_id, task_type, reset_date)
  DO UPDATE SET
    current_progress = public.task_progress.current_progress + p_amount,
    updated_at = timezone('utc'::text, now())
  RETURNING current_progress INTO new_value;

  RETURN new_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_user_daily_task(
  p_user_id UUID,
  p_date DATE,
  p_field TEXT,
  p_amount INT,
  p_recharged BOOLEAN DEFAULT FALSE
)
RETURNS NUMERIC(12, 2)
LANGUAGE plpgsql
AS $$
DECLARE
  new_val NUMERIC(12, 2);
BEGIN
  IF p_field = 'consume' THEN
    INSERT INTO public.user_daily_tasks (user_id, date, daily_energy_consumed, daily_money_recharged, recharge_processed)
    VALUES (p_user_id, p_date, p_amount, 0, FALSE)
    ON CONFLICT (user_id, date)
    DO UPDATE SET
      daily_energy_consumed = public.user_daily_tasks.daily_energy_consumed + p_amount,
      updated_at = timezone('utc'::text, now())
    RETURNING daily_energy_consumed::NUMERIC(12, 2) INTO new_val;
  ELSIF p_field = 'recharge' THEN
    INSERT INTO public.user_daily_tasks (user_id, date, daily_energy_consumed, daily_money_recharged, recharge_processed)
    VALUES (p_user_id, p_date, 0, p_amount, p_recharged)
    ON CONFLICT (user_id, date)
    DO UPDATE SET
      daily_money_recharged = public.user_daily_tasks.daily_money_recharged + p_amount,
      recharge_processed = public.user_daily_tasks.recharge_processed OR p_recharged,
      updated_at = timezone('utc'::text, now())
    RETURNING daily_money_recharged INTO new_val;
  ELSE
    RAISE EXCEPTION 'INVALID_DAILY_TASK_FIELD';
  END IF;

  RETURN COALESCE(new_val, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_expired_items()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  affected_users INT;
  current_activity_end TIMESTAMPTZ;
BEGIN
  SELECT end_time INTO current_activity_end
  FROM public.activities
  WHERE config->>'isGlobalEnabled' = 'true'
  ORDER BY id ASC
  LIMIT 1;

  IF current_activity_end IS NULL THEN
    RETURN 0;
  END IF;

  IF current_activity_end <= NOW() THEN
    UPDATE public.user_inventory
    SET item_hand_count = 0,
        item_phallus_count = 0,
        updated_at = timezone('utc'::text, now())
    WHERE item_hand_count > 0 OR item_phallus_count > 0;

    GET DIAGNOSTICS affected_users = ROW_COUNT;
    RETURN affected_users;
  END IF;

  RETURN 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_daily_tasks()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  affected_rows INT;
BEGIN
  UPDATE public.task_progress
  SET is_claimed = true,
      updated_at = timezone('utc'::text, now())
  WHERE is_claimed = false
    AND reset_date < CURRENT_DATE;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows;
END;
$$;

-- =============================================================================
-- claim_personal_milestone_reward
--
-- ⚠️ DEPRECATED (REPARK 7.0, 2026-08-24) — DO NOT CALL FROM PRODUCTION.
-- Superseded by the JS-layer claim paths (see migration 12 for full banner).
-- Kept in aws_03_functions.sql to mirror the prod schema; the body itself is
-- NOT changed because nothing invokes it, but the COMMENT below makes the
-- deprecation visible to anyone introspecting pg_catalog.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.claim_personal_milestone_reward(
  p_user_id       UUID,
  p_milestone_id  INTEGER,
  p_threshold     BIGINT,
  p_reward_type   TEXT,
  p_reward_value  TEXT,
  p_claimed_at    TIMESTAMPTZ
)
RETURNS TABLE (
  claimed_at TIMESTAMPTZ,
  reward_type TEXT,
  reward_value TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_damage BIGINT := 0;
  v_existing_claimed BOOLEAN := FALSE;
  v_existing_locked BOOLEAN := FALSE;
BEGIN
  -- ⚠️ DEPRECATED — DO NOT CALL (REPARK 7.0, 2026-08-24).
  -- Mirror-only; see supabase/migrations/12_add_personal_milestone_rpc.sql
  -- for the canonical deprecation banner. Body unchanged.
  -- DEPRECATED — DO NOT CALL — DEPRECATED — DO NOT CALL — DEPRECATED

  IF p_reward_type NOT IN ('ENERGY', 'MEDAL') THEN
    RAISE EXCEPTION 'INVALID_REWARD_TYPE';
  END IF;

  SELECT COALESCE(ui.total_damage_dealt, 0)
    INTO v_total_damage
  FROM public.user_inventory ui
  WHERE ui.user_id = p_user_id;

  IF v_total_damage < p_threshold THEN
    RAISE EXCEPTION 'THRESHOLD_NOT_MET';
  END IF;

  SELECT mr.is_claimed, COALESCE(mr.is_locked, FALSE)
    INTO v_existing_claimed, v_existing_locked
  FROM public.milestone_rewards mr
  WHERE mr.user_id = p_user_id
    AND mr.milestone_id = p_milestone_id;

  IF v_existing_locked THEN
    RAISE EXCEPTION 'MILESTONE_LOCKED';
  END IF;

  IF v_existing_claimed THEN
    RAISE EXCEPTION 'ALREADY_CLAIMED';
  END IF;

  INSERT INTO public.milestone_rewards (
    user_id,
    milestone_id,
    is_claimed,
    claimed_at,
    reward_type,
    reward_value,
    is_locked
  )
  VALUES (
    p_user_id,
    p_milestone_id,
    TRUE,
    p_claimed_at,
    p_reward_type,
    p_reward_value,
    FALSE
  )
  ON CONFLICT (user_id, milestone_id)
  DO UPDATE SET
    is_claimed = TRUE,
    claimed_at = EXCLUDED.claimed_at,
    reward_type = EXCLUDED.reward_type,
    reward_value = EXCLUDED.reward_value
  WHERE public.milestone_rewards.is_claimed = FALSE
    AND COALESCE(public.milestone_rewards.is_locked, FALSE) = FALSE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_CONFLICT';
  END IF;

  IF p_reward_type = 'ENERGY' THEN
    INSERT INTO public.user_inventory (
      user_id,
      item_hand_count,
      item_phallus_count,
      total_damage_dealt
    )
    VALUES (
      p_user_id,
      1,
      0,
      0
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
      item_hand_count = public.user_inventory.item_hand_count + 1,
      updated_at = timezone('utc'::text, now());
  END IF;

  RETURN QUERY
  SELECT p_claimed_at, p_reward_type, p_reward_value;
END;
$$;

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
