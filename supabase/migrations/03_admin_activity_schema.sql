-- Migration: 03_admin_activity_schema.sql
-- Creates the activities table for the Admin Activity Management feature.
-- Uses camelCase fields (id, name, type, startTime, endTime, status) internally.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ACTIVITIES TABLE
-- Stores all game events. Two types: LIVE2D (Spine/Live2D boss battles) and
-- ENERGY (daily recharge / resource drain events).
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS activities (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(50) NOT NULL,
  type        VARCHAR(10) NOT NULL CHECK (type IN ('LIVE2D', 'ENERGY')),
  start_time  TIMESTAMPTZ NOT NULL,
  end_time    TIMESTAMPTZ NOT NULL,
  status      VARCHAR(10) NOT NULL DEFAULT 'DISABLED' CHECK (status IN ('ENABLED', 'DISABLED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure end_time is after start_time
ALTER TABLE activities
  ADD CONSTRAINT activities_end_after_start
  CHECK (end_time > start_time);

-- Prevent duplicate active periods for the same activity name
CREATE UNIQUE INDEX IF NOT EXISTS activities_name_active_window
  ON activities (name, start_time, end_time)
  WHERE status = 'ENABLED';

-- RLS: allow service role full access; admins go through the API routes
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

-- Admins (service role) can do anything
CREATE POLICY "Service role full access to activities"
  ON activities FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Block direct client access
CREATE POLICY "No direct client access to activities"
  ON activities FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

COMMIT;
