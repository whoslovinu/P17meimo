-- ═══════════════════════════════════════════════════════════════════════════════
-- 16 — public.badges (Badge Catalog MVP)
--     REPARK Phase 1: Badge System implementation.
--     Creates the `public.badges` table that the admin UI's MilestoneCard
--     badge-ID preview already calls (/api/admin/badge/[id]). Until this
--     migration runs the route returns hard-coded `placehold.co` mock data.
--
-- Design notes:
--   - BIGSERIAL primary key — admin operators reference badges by numeric ID
--     (e.g. "10021", "10035"), matching the existing activity.config.milestones[].medalId
--     pattern. The current mock used IDs 1..10; we deliberately start the
--     real catalog at 10000+ to avoid colliding with any operator-typed IDs
--     already in saved activities, while remaining compatible with the
--     "10021 初级挑战者" / "10035 魅魔征服者" examples cited in the brief.
--   - thumbnail is a TEXT URL (CDN/OSS) — same shape as the previous mock
--     so the MilestoneCard `<img>` continues to work without changes.
--   - description is free text for admin context (displayed in future
--     `/admin/badges` page; not yet consumed by H5).
--   - is_active is a soft-delete flag — keeps historical reward_value rows
--     resolvable even after an admin "deletes" a badge.
--   - RLS is intentionally NOT enabled because the production target is AWS
--     RDS without a Supabase `service_role` role. Access is gated at the
--     application layer (only Next.js server uses the connection pool).
--     Same rationale as migration 15_webhook_audit_table.sql.
--
-- Execution:
--   1. Run via: node scripts/deploy_aws_db.mjs
--      Or directly: psql "$DATABASE_URL" -f 16_add_badges_table.sql
--   2. Verify: SELECT id, name FROM public.badges ORDER BY id;
--
-- DO NOT MODIFY: milestone_rewards / activities / users tables. This
-- migration only creates the badge catalog.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. CREATE TABLE ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.badges (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT    NOT NULL,
  thumbnail    TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. INDEXES ───────────────────────────────────────────────────────────────
--   - `is_active` index supports the active-only listing query.
--   - `id` is already indexed via PRIMARY KEY.

CREATE INDEX IF NOT EXISTS idx_badges_active
  ON public.badges (is_active);

-- ── 3. AUTO-UPDATE updated_at ────────────────────────────────────────────────
--   Mirrors the convention used in production tables (e.g. user_daily_tasks).
--   Migration 14_fix_user_daily_tasks_updated_at.sql applied the same trigger
--   pattern, so we follow that precedent.

CREATE OR REPLACE FUNCTION public.touch_badges_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_badges_updated_at ON public.badges;
CREATE TRIGGER trg_badges_updated_at
  BEFORE UPDATE ON public.badges
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_badges_updated_at();

-- ── 4. SEED DEMO BADGES ──────────────────────────────────────────────────────
--
-- Replaces the 10 hard-coded `placehold.co` mock badges the admin UI has been
-- previewing since the MilestoneCard feature shipped. IDs are intentionally
-- 10000+ to match the brief's example IDs ("10021 初级挑战者",
-- "10035 魅魔征服者") and to leave room for legacy operator-typed small IDs.
--
-- ON CONFLICT DO NOTHING keeps the seed idempotent — re-running the
-- migration will not overwrite operator edits.

INSERT INTO public.badges (id, name, thumbnail, description, is_active)
VALUES
  (10021, '初级挑战者',  'https://placehold.co/100x100/blue/white?text=B1',     '完成首个个人进度奖励的勇敢新星',                 true),
  (10022, '无畏冲锋者',  'https://placehold.co/100x100/cyan/white?text=B2',    '累计个人伤害突破 1,000 点的勇者',                true),
  (10023, '资深挑战者',  'https://placehold.co/100x100/emerald/white?text=B3', '累计个人伤害突破 5,000 点的老练玩家',             true),
  (10024, '精英猎手',    'https://placehold.co/100x100/amber/white?text=B4',   '累计个人伤害突破 10,000 点的精英',                true),
  (10025, '深渊探险者',  'https://placehold.co/100x100/violet/white?text=B5',  '累计个人伤害突破 25,000 点的先驱者',              true),
  (10026, '烈焰使者',    'https://placehold.co/100x100/red/white?text=B6',     '累计个人伤害突破 50,000 点的烈焰战士',           true),
  (10027, '雷霆战神',    'https://placehold.co/100x100/yellow/white?text=B7',  '累计个人伤害突破 100,000 点的雷霆掌控者',         true),
  (10028, '虚空漫游者',  'https://placehold.co/100x100/gray/white?text=B8',    '累计个人伤害突破 250,000 点的维度行者',           true),
  (10029, '星辰主宰',    'https://placehold.co/100x100/indigo/white?text=B9',  '累计个人伤害突破 500,000 点的星辰征服者',         true),
  (10035, '魅魔征服者',  'https://placehold.co/100x100/pink/white?text=B10',   '击破深渊魅魔 Boss 最高阶段奖励的终极证明',         true)
ON CONFLICT (id) DO NOTHING;

-- ── 5. RESYNC SERIAL SEQUENCE ────────────────────────────────────────────────
--
-- BIGSERIAL creates a backing sequence (public.badges_id_seq). After an
-- idempotent INSERT with explicit IDs the sequence may be out of sync with
-- the actual max(id) — calling `setval` with `is_called=true` keeps nextval
-- monotonic with the seeded rows so a future INSERT (without explicit id)
-- will not collide.

SELECT setval(
  pg_get_serial_sequence('public.badges', 'id'),
  GREATEST(
    COALESCE((SELECT MAX(id) FROM public.badges), 1),
    1
  ),
  true
);

COMMIT;

-- ── Verification queries (run manually after migration) ──────────────────────
--
--   SELECT id, name, is_active FROM public.badges ORDER BY id;
--   SELECT COUNT(*) FROM public.badges WHERE is_active = true;
