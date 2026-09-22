-- Migration: 05_banners_table.sql
-- Author: Agent 1 [Cyber-Blacksmith]
-- Date: 2026-05-16
-- Purpose: Create banners table and add banner_global config to activities.
--          Decouples the banner system from local JSON mock persistence.
--
-- Execution:
--   1. Run against the AWS RDS production instance via:
--      node scripts/deploy_aws_db.mjs (uses the local SSH tunnel)
--   2. Use Supabase Dashboard > SQL Editor, or:
--      supabase db push
--      supabase migration up
--   3. Verify: SELECT * FROM banners LIMIT 1;
--      SELECT config FROM activities LIMIT 1;
--
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. BANNERS TABLE
--    Snake_case columns match the existing snake_case schema conventions.
--    Naming convention intentionally mirrors the legacy app/api/banner/route.ts
--    for backward compatibility.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.banners (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  image_url     TEXT        NOT NULL DEFAULT '',
  redirect_id   TEXT        NOT NULL DEFAULT '',
  redirect_type TEXT        NOT NULL DEFAULT 'none'
                      CHECK (redirect_type IN ('activity', 'external', 'none')),
  is_active     BOOLEAN     NOT NULL DEFAULT false,   -- camelCase frontend: isEnabled
  show_countdown BOOLEAN    NOT NULL DEFAULT false,   -- camelCase frontend: showCountdown
  sort_order    INTEGER     NOT NULL DEFAULT 0,       -- camelCase frontend: sortWeight
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index: fast filter by is_active for H5 consumer
CREATE INDEX IF NOT EXISTS banners_is_active_idx
  ON public.banners ((is_active))
  WHERE is_active = true;

-- Index: fast sort by sort_order
CREATE INDEX IF NOT EXISTS banners_sort_order_idx
  ON public.banners ((sort_order));

-- RLS: service role has full access (backend uses service role key)
ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to banners"
  ON public.banners FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow authenticated reads for H5 (banner carousel is public content)
CREATE POLICY "Authenticated users can read banners"
  ON public.banners FOR SELECT
  TO authenticated
  USING (true);

-- Block all client-side mutations — service role only
CREATE POLICY "No direct client access to banners"
  ON public.banners FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "No direct client update to banners"
  ON public.banners FOR UPDATE
  TO authenticated
  USING (false);

CREATE POLICY "No direct client delete from banners"
  ON public.banners FOR DELETE
  TO authenticated
  USING (false);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. BANNER_GLOBAL CONFIG IN ACTIVITIES
--    The `activities.config` JSONB column already exists (migration 04).
--    We use the key `banner_global` to namespace banner settings.
--    Shape: { banner_global: { isGlobalEnabled, isCarouselEnabled, carouselInterval } }
--
--    Strategy: We upsert a single "system" activity row that owns the banner
--    global config. The activity has name = '__banner_global__' and is always
--    TYPE = 'LIVE2D', STATUS = 'DISABLED' (it is never a game activity).
-- ═══════════════════════════════════════════════════════════════════════════════

-- Upsert the system row that owns banner_global
INSERT INTO public.activities (id, name, type, start_time, end_time, status, config)
VALUES (
  999999,
  '__banner_global__',
  'LIVE2D',
  '2026-01-01T00:00:00Z',
  '2099-12-31T23:59:59Z',
  'DISABLED',
  '{"isGlobalEnabled": false, "isCarouselEnabled": true, "carouselInterval": 5}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  type        = EXCLUDED.type,
  start_time  = EXCLUDED.start_time,
  end_time    = EXCLUDED.end_time,
  status      = EXCLUDED.status,
  config      = EXCLUDED.config;

-- Protect the system row from accidental deletion or ID changes
-- (Add a comment for documentation; enforced by application logic.)

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. SEED DATA (dev only — comment out in production)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Uncomment below to seed dev data after first migration run:
--
-- INSERT INTO public.banners (id, image_url, redirect_id, redirect_type, is_active, show_countdown, sort_order)
-- VALUES
--   ('banner-001', '/uploads/logo_1778303356530.png', '1', 'activity', true, true, 1),
--   ('banner-002', '', '', 'none', true, true, 2)
-- ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- 1. Check banners table exists:
--    SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'banners' ORDER BY ordinal_position;
--
-- 2. Check banner_global row:
--    SELECT id, name, config FROM activities WHERE id = 999999;
--
-- 3. Insert a test banner:
--    INSERT INTO public.banners (image_url, redirect_id, redirect_type, is_active, show_countdown, sort_order)
--    VALUES ('/uploads/test.png', '1', 'activity', true, true, 1)
--    RETURNING *;
--
-- 4. Read banners for H5 (active only, sorted):
--    SELECT id, image_url, redirect_id, redirect_type, is_active, show_countdown, sort_order
--    FROM public.banners
--    WHERE is_active = true
--    ORDER BY sort_order ASC;
