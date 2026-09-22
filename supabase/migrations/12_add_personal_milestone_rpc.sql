-- =============================================================================
-- Migration: 12_add_personal_milestone_rpc.sql
--
-- ⚠️ DEPRECATED (REPARK 7.0, 2026-08-24) — DO NOT CALL FROM PRODUCTION.
-- This RPC was superseded by the JS-layer claim paths:
--   - app/api/game/milestone/claim/route.ts
--   - app/api/battle/reward-claim/route.ts
-- Both read activity-scoped damage via lib/db/pg.ts → getActivityDamage(),
-- which queries user_activity_stats (NOT user_inventory.total_damage_dealt).
--
-- Kept in the migration history for back-compat / audit only. No TS/JS
-- runtime calls this function. DO NOT delete this file — its presence in the
-- migration ledger is required so existing production databases can still
-- upgrade cleanly. New code MUST NOT invoke it.
-- =============================================================================
--
-- Creates:
--   public.claim_personal_milestone_reward(
--     p_user_id UUID,
--     p_milestone_id INTEGER,
--     p_threshold BIGINT,
--     p_reward_type TEXT,
--     p_reward_value TEXT,
--     p_claimed_at TIMESTAMPTZ
--   )
--
-- Guarantees:
--   1. Validates user total_damage_dealt >= p_threshold inside PostgreSQL
--   2. Rejects locked or already-claimed milestones
--   3. Marks milestone claimed atomically
--   4. Grants reward atomically in the same transaction
--   5. Safe to call repeatedly without double-granting
-- =============================================================================

DROP FUNCTION IF EXISTS public.claim_personal_milestone_reward(UUID, INTEGER, BIGINT, TEXT, TEXT, TIMESTAMPTZ);

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
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_damage BIGINT := 0;
  v_existing_claimed BOOLEAN := FALSE;
  v_existing_locked BOOLEAN := FALSE;
BEGIN
  -- ⚠️ DEPRECATED — DO NOT CALL (REPARK 7.0, 2026-08-24).
  -- This function body still reads the GLOBAL user_inventory.total_damage_dealt,
  -- which is the WRONG source for milestone unlock. Production callers must
  -- use the JS-layer paths (see file header for pointers). The body is kept
  -- intact here purely so production databases can still upgrade cleanly.
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
    is_claimed   = TRUE,
    claimed_at   = EXCLUDED.claimed_at,
    reward_type  = EXCLUDED.reward_type,
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
      updated_at = NOW();
  END IF;

  RETURN QUERY
  SELECT p_claimed_at, p_reward_type, p_reward_value;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_personal_milestone_reward(UUID, INTEGER, BIGINT, TEXT, TEXT, TIMESTAMPTZ)
  TO authenticated;

COMMENT ON FUNCTION public.claim_personal_milestone_reward IS
  '[DEPRECATED 2026-08-24] Phase 1 attempt — superseded by the JS-layer claim paths (app/api/game/milestone/claim + app/api/battle/reward-claim) which read ACTIVITY-SCOPED damage from user_activity_stats. This function still reads the GLOBAL user_inventory.total_damage_dealt — DO NOT CALL. Kept for migration history only.';
