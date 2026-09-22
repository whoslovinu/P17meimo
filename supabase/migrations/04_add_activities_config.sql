-- Migration: 04_add_activities_config.sql
-- Author: Agent 1 [Cyber-Blacksmith]
-- Date: 2026-05-14
-- Purpose: Add `config` JSONB column to activities table to enable adConfig
--          persistence and rules text storage for the H5 Rules popup.
--
-- Root Cause: activities table was created without the `config` column,
--             causing all adConfig saves and rules to be lost in production.
--             This was the CRITICAL root cause of TC-AM-11 PARTIAL and
--             all "rules FAIL" / "adConfig FAIL" findings.
--
-- Execution:
--   1. Run against the AWS RDS production instance via:
--      node scripts/deploy_aws_db.mjs (uses the local SSH tunnel)
--   2. Use Supabase Dashboard > SQL Editor, or:
--      supabase db push
--      supabase migration up
--   3. Verify: SELECT config FROM activities LIMIT 1; (should be NULL or JSON object)
--
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Add config JSONB column with safe default for existing rows
-- IF NOT EXISTS prevents errors on re-run
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS config JSONB
  DEFAULT '{"isGlobalEnabled": false}'::jsonb;

-- Add RLS policy so service role can read/write config
-- (table already has service_role policy from migration 03)

-- Index on config for faster queries on isGlobalEnabled
-- Partial index: only index rows where config is not null
CREATE INDEX IF NOT EXISTS activities_config_idx
  ON activities ((config->>'isGlobalEnabled'))
  WHERE config IS NOT NULL;

-- Verify the column was added
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'activities'
      AND column_name = 'config'
  ) THEN
    RAISE EXCEPTION 'Failed to add config column to activities table';
  END IF;
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES (run these in Supabase SQL Editor after migration)
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- 1. Check column exists:
--    SELECT column_name, data_type, column_default
--    FROM information_schema.columns
--    WHERE table_name = 'activities' AND column_name = 'config';
--
-- 2. Check existing rows have default config:
--    SELECT id, name, config FROM activities LIMIT 5;
--
-- 3. After creating a new activity, verify config is set:
--    INSERT INTO activities (name, type, start_time, end_time, status, config)
--    VALUES ('Test', 'LIVE2D', NOW(), NOW() + INTERVAL '30 days', 'DISABLED',
--            '{"isGlobalEnabled": false, "rules": "", "boss": {"totalHp": 100000, "currentHp": 100000}}');
--    SELECT id, name, config FROM activities WHERE name = 'Test';
