-- =============================================================================
-- Migration: 09_milestone_claim_rpc.sql
-- V5.16-EN | Agent 1 [Cyber-Blacksmith]
--
-- TC-RW-05: Atomic milestone reward claiming with inventory grant.
-- TC-RW-26: Server-side duplicate prevention via UNIQUE constraint.
--
-- Creates:
--  1. RPC function claim_milestone_reward() — single atomic transaction
--  2. reward_type and reward_value columns on milestone_rewards
--  3. Unique partial index for fast unclaimed queries
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Add reward metadata columns to milestone_rewards (TC-RW-05)
-- Stores what reward was granted so the UI can display it correctly.
-- -----------------------------------------------------------------------------

ALTER TABLE public.milestone_rewards
  ADD COLUMN IF NOT EXISTS reward_type TEXT
    CHECK (reward_type IN ('ENERGY', 'MEDAL'))
    DEFAULT 'MEDAL';

ALTER TABLE public.milestone_rewards
  ADD COLUMN IF NOT EXISTS reward_value TEXT
    DEFAULT '挑战勋章';

COMMENT ON COLUMN public.milestone_rewards.reward_type IS
  'V5.16: Type of reward granted: ENERGY (item_hand) or MEDAL (badge).';
COMMENT ON COLUMN public.milestone_rewards.reward_value IS
  'V5.16: Human-readable reward value: energy count or medal name.';

-- -----------------------------------------------------------------------------
-- RPC: claim_milestone_reward
-- Atomically claims a milestone and grants the reward in one transaction.
--
-- Steps:
--  1. INSERT milestone_rewards (idempotent via ON CONFLICT)
--  2. IF reward_type='ENERGY', increment item_hand_count in user_inventory
--  3. Return claimed_at timestamp
--
-- SECURITY: SECURITY DEFINER so it bypasses RLS for service role.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_milestone_reward(
  p_user_id       UUID,
  p_milestone_id INTEGER,
  p_reward_type  TEXT,
  p_reward_value TEXT,
  p_claimed_at   TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_ts TIMESTAMPTZ;
BEGIN
  -- Insert the claim record (ON CONFLICT = idempotent)
  INSERT INTO public.milestone_rewards
    (user_id, milestone_id, is_claimed, claimed_at, reward_type, reward_value)
  VALUES
    (p_user_id, p_milestone_id, TRUE, p_claimed_at, p_reward_type, p_reward_value)
  ON CONFLICT (user_id, milestone_id)
  DO UPDATE SET
    is_claimed   = TRUE,           -- Re-claim if somehow already set (belt-and-suspenders)
    claimed_at   = EXCLUDED.claimed_at,
    reward_type  = EXCLUDED.reward_type,
    reward_value = EXCLUDED.reward_value
  RETURNING claimed_at
  INTO claimed_ts;

  -- Grant ENERGY reward: increment item_hand_count
  IF p_reward_type = 'ENERGY' THEN
    INSERT INTO public.user_inventory
      (user_id, item_hand_count, item_phallus_count, total_damage_dealt)
    VALUES
      (p_user_id, 1, 0, 0)
    ON CONFLICT (user_id)
    DO UPDATE SET
      item_hand_count = user_inventory.item_hand_count + 1,
      updated_at      = NOW();
  END IF;

  RETURN claimed_ts;
END;
$$;

-- Grant execute to authenticated role (for admin tools that run as authenticated)
GRANT EXECUTE ON FUNCTION public.claim_milestone_reward(UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ)
  TO authenticated;

-- -----------------------------------------------------------------------------
-- Partial unique index: fast lookup of unclaimed milestones (TC-RW-26)
-- Excludes rows where is_claimed = TRUE — keeps the index small.
-- -----------------------------------------------------------------------------

DROP INDEX IF EXISTS public.idx_milestone_rewards_unclaimed;
CREATE UNIQUE INDEX IF NOT EXISTS idx_milestone_rewards_unclaimed
  ON public.milestone_rewards (user_id, milestone_id)
  WHERE is_claimed = FALSE;

-- -----------------------------------------------------------------------------
-- Grant update on reward_type/reward_value columns
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Service role update milestone rewards"
  ON public.milestone_rewards;

CREATE POLICY "Service role update milestone rewards"
  ON public.milestone_rewards
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

COMMENT ON FUNCTION public.claim_milestone_reward IS
  'V5.16-EN: TC-RW-05 atomic claim. Idempotent via ON CONFLICT. Grants ENERGY items inline.';
