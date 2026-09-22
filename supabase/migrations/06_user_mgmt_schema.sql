-- Migration: 06_user_mgmt_schema.sql
-- Author: Agent 1 [Cyber-Blacksmith]
-- Date: 2026-05-16
-- Purpose: Complete user management overhaul — fixes TC-UM-01~18
--   1. Add is_locked to milestone_rewards (TC-UM-05)
--   2. Add email to users table (TC-UM-01)
--   3. Create admin_audit_log table (LB-06)
--   4. Seed admin demo users
--
-- Execution:
--   1. Run against the AWS RDS production instance via:
--      node scripts/deploy_aws_db.mjs (uses the local SSH tunnel)
--   2. Use Supabase Dashboard > SQL Editor, or: supabase db push
--   3. Verify: SELECT * FROM milestone_rewards LIMIT 1;
--      SELECT * FROM admin_audit_log LIMIT 1;
--
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. ADD is_locked TO milestone_rewards (TC-UM-05)
--    Blocks H5 from claiming a milestone that an admin has flagged as abnormal.
--    Default: false (normal behavior)
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.milestone_rewards
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;

-- Guard: locked milestones cannot be claimed
-- The H5 must check is_locked=true before allowing a claim.
-- DB-level enforcement via CHECK constraint:
ALTER TABLE public.milestone_rewards
  DROP CONSTRAINT IF EXISTS milestone_rewards_locked_guard;
ALTER TABLE public.milestone_rewards
  ADD CONSTRAINT milestone_rewards_locked_guard
  CHECK (NOT (is_locked = true AND is_claimed = true AND claimed_at IS NOT NULL))
  NOT VALID;

-- Re-validate the constraint after backfilling existing rows
ALTER TABLE public.milestone_rewards VALIDATE CONSTRAINT milestone_rewards_locked_guard;

-- Index: fast lookup of locked milestones per user
CREATE INDEX IF NOT EXISTS idx_milestone_rewards_locked
  ON public.milestone_rewards ((is_locked))
  WHERE is_locked = true;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. ADD email TO users TABLE (TC-UM-01)
--    Required for email-based user search per Section 10.2 spec.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS nickname TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT '👤';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. CREATE admin_audit_log TABLE (LB-06)
--    Immutable audit trail for all admin override actions.
--    Append-only: no UPDATE or DELETE allowed.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id            BIGSERIAL PRIMARY KEY,
  route        TEXT        NOT NULL,              -- e.g. /api/admin/user/update
  action       TEXT        NOT NULL,              -- e.g. update_inventory, force_unlock, lock_milestone
  operator_id  TEXT        NOT NULL,             -- admin session/user identifier
  target_user_id TEXT      NOT NULL,              -- affected user UUID
  field_name   TEXT,                              -- specific field modified (or null for multi-field)
  old_value    TEXT,                              -- JSON serialized previous value
  new_value    TEXT,                              -- JSON serialized new value
  ip_address   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: service role full access (admin API routes use service role key)
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to audit log"
  ON public.admin_audit_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Prevent authenticated users from reading audit logs
CREATE POLICY "No direct client access to audit log"
  ON public.admin_audit_log FOR ALL
  TO authenticated
  USING (false);

-- Index: fast queries by target user
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target_user
  ON public.admin_audit_log ((target_user_id));

-- Index: fast queries by action type
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action
  ON public.admin_audit_log ((action));

-- Index: fast queries by time range
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at
  ON public.admin_audit_log ((created_at) DESC);

-- Index: composite for user + time range
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_user_time
  ON public.admin_audit_log (target_user_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. SEED ADMIN DEMO USERS (dev + production reference data)
--    These match mock_db_users.json so the UI continues to work in dev.
--    Comment out or override in production.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Seed 10 demo users matching mock_db_users.json
INSERT INTO public.users (id, email, nickname, avatar, total_damage_dealt)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'dev@test.local', 'Test User (Dev)', '🧪', 292),
  ('u-00000000-0000-0001', 'user001@test.local', '深渊猎手零', '🗡️', 188420),
  ('u-00000000-0000-0002', 'user002@test.local', '魅影骑士', '🌙', 93450),
  ('u-00000000-0000-0003', 'user003@test.local', '符文法阵师', '⚡', 412880),
  ('u-00000000-0000-0004', 'user004@test.local', '深渊观察者', '👁️', 3200),
  ('u-00000000-0000-0005', 'user005@test.local', '符文狂热者', '🔥', 1203340),
  ('u-00000000-0000-0006', 'user006@test.local', '潮汐守望者', '🌊', 78900),
  ('u-00000000-0000-0007', 'user007@test.local', '虚空漫游者', '🌀', 12400),
  ('u-00000000-0000-0008', 'user008@test.local', '圣殿裁决者', '⚖️', 298700),
  ('u-00000000-0000-0009', 'user009@test.local', '深渊新手A', '🌱', 450),
  ('u-00000000-0000-0010', 'user010@test.local', '深渊新手B', '🌿', 820)
ON CONFLICT (id) DO UPDATE SET
  email            = EXCLUDED.email,
  nickname         = EXCLUDED.nickname,
  avatar           = EXCLUDED.avatar,
  total_damage_dealt = EXCLUDED.total_damage_dealt;

-- Seed user_inventory for demo users
INSERT INTO public.user_inventory (user_id, item_hand_count, item_phallus_count, total_damage_dealt)
VALUES
  ('00000000-0000-0000-0000-000000000000', 5000, 5000, 292),
  ('u-00000000-0000-0001', 142, 7, 188420),
  ('u-00000000-0000-0002', 89, 23, 93450),
  ('u-00000000-0000-0003', 311, 1, 412880),
  ('u-00000000-0000-0004', 5, 0, 3200),
  ('u-00000000-0000-0005', 578, 44, 1203340),
  ('u-00000000-0000-0006', 67, 118, 78900),
  ('u-00000000-0000-0007', 23, 3, 12400),
  ('u-00000000-0000-0008', 888, 15, 298700),
  ('u-00000000-0000-0009', 3, 0, 450),
  ('u-00000000-0000-0010', 1, 1, 820)
ON CONFLICT (user_id) DO UPDATE SET
  item_hand_count    = EXCLUDED.item_hand_count,
  item_phallus_count = EXCLUDED.item_phallus_count,
  total_damage_dealt = EXCLUDED.total_damage_dealt;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- 1. Check is_locked column:
--    SELECT column_name, data_type, column_default
--    FROM information_schema.columns
--    WHERE table_name = 'milestone_rewards' AND column_name = 'is_locked';
--
-- 2. Check email column:
--    SELECT id, email, nickname FROM public.users LIMIT 3;
--
-- 3. Check audit log table:
--    SELECT id, action, target_user_id, created_at FROM public.admin_audit_log LIMIT 3;
--
-- 4. Dynamic damage aggregation (TC-UM-02):
--    SELECT
--      u.id,
--      COALESCE(SUM(al.damage_dealt), 0) AS computed_damage
--    FROM public.users u
--    LEFT JOIN public.attack_logs al ON al.user_id = u.id
--    GROUP BY u.id
--    ORDER BY computed_damage DESC;
--
-- 5. Search by email (TC-UM-01):
--    SELECT * FROM public.users WHERE email ILIKE '%user001%';
