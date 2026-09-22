-- =============================================================================
-- Migration: 10_milestone_lock_column.sql
-- V5.19-EN | Agent 1 [Cyber-Blacksmith] | REPARK Pre-Flight Audit
--
-- PURPOSE: Align TypeScript types with Supabase schema.
--
-- The milestone_rewards table is queried with `is_locked` column throughout the
-- codebase (userDb.ts, milestone route, admin export, admin users page) but the
-- column was never added via migration. This creates the missing column.
--
-- Alignment Matrix:
--   TypeScript database.types.ts milestone_rewards → has is_locked: boolean
--   userDb.ts getUserMilestones()                   → selects is_locked
--   app/api/admin/user/milestone/route.ts           → updates is_locked
--   app/api/admin/user/export/route.ts             → exports is_locked
--   app/admin/users/page.tsx                        → reads is_locked
-- =============================================================================

BEGIN;

-- ── Add is_locked column ────────────────────────────────────────────────────────
-- Default: FALSE (all milestones start unlocked; admin can lock them manually)
ALTER TABLE public.milestone_rewards
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.milestone_rewards.is_locked IS
  'V5.19: Whether this milestone is manually locked by admin. When TRUE, user cannot claim even if HP threshold is met.';

-- ── Update RLS Policy ──────────────────────────────────────────────────────────
-- Ensure service role can read/write is_locked
DROP POLICY IF EXISTS "service_role_full_access_milestones" ON public.milestone_rewards;

CREATE POLICY "service_role_full_access_milestones" ON public.milestone_rewards
  FOR ALL USING (true);

-- ── Update grant (service role already has ALL on tables, but be explicit) ───────
GRANT UPDATE (is_locked) ON public.milestone_rewards TO service_role;
GRANT SELECT (is_locked) ON public.milestone_rewards TO service_role;

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────────
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'milestone_rewards'
--   ORDER BY ordinal_position;
