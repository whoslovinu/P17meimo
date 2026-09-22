-- =============================================================================
-- Migration: 17_milestone_admin_bypass.sql
-- (Proposed — DO NOT apply in this sprint without Commander approval)
--
-- PURPOSE:
--   Add an explicit "admin bypass" flag to milestone_rewards that distinguishes
--   "special unlock granted by admin" from "ordinary unlocked / not yet locked".
--   This is the persistent record of the "允许指定用户领取, 绕过伤害门槛"
--   admin special-permission action.
--
--   Without this column, the override route can only set is_locked=false, which
--   is indistinguishable from "never locked" and thus cannot reliably tell the
--   claim route to bypass the threshold check.
--
-- COLUMN SPEC:
--   admin_bypass BOOLEAN NOT NULL DEFAULT FALSE
--     • Set TRUE when admin issues a special unlock (POST .../override action=unlock).
--     • Set FALSE by claim route after the player successfully claims (whether
--       via normal threshold or admin bypass — single-use semantics).
--     • lock action does NOT change admin_bypass (only blocks future claim).
--     • Override-unlock on an already-claimed milestone is a no-op for
--       admin_bypass (cannot create new grant opportunity).
--
--   source TEXT DEFAULT NULL
--     • Optional audit trail: 'override:reason_text'. NULL if not bypassed.
--
-- INDEX:
--   Fast lookup of bypassed milestones per user for admin UI.
--
-- ROLLBACK PLAN:
--   ALTER TABLE public.milestone_rewards DROP COLUMN IF EXISTS admin_bypass;
--   ALTER TABLE public.milestone_rewards DROP COLUMN IF EXISTS admin_bypass_source;
--   DROP INDEX IF EXISTS idx_milestone_rewards_admin_bypass;
-- =============================================================================

BEGIN;

-- ── Add admin_bypass column ──────────────────────────────────────────────────
ALTER TABLE public.milestone_rewards
  ADD COLUMN IF NOT EXISTS admin_bypass BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.milestone_rewards.admin_bypass IS
  'V7.0: Admin special unlock — when TRUE, claim route bypasses damage threshold.
   Single-use: cleared by claim route on successful claim.
   Distinct from is_locked (which BLOCKS claims) and is_claimed (which MARKS claims).';

-- ── Add admin_bypass_source for audit ────────────────────────────────────────
ALTER TABLE public.milestone_rewards
  ADD COLUMN IF NOT EXISTS admin_bypass_source TEXT DEFAULT NULL;

COMMENT ON COLUMN public.milestone_rewards.admin_bypass_source IS
  'V7.0: Audit trail — the admin reason text provided when admin_bypass was set.';

-- ── Index for fast admin UI lookup ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_milestone_rewards_admin_bypass
  ON public.milestone_rewards (user_id)
  WHERE admin_bypass = TRUE;

COMMIT;

-- ── Verification ──────────────────────────────────────────────────────────────
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'milestone_rewards'
--   ORDER BY ordinal_position;
