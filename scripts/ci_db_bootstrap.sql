# ============================================================
# CI Bootstrap SQL — P17 Activity Inventory DB Gate
# ============================================================
# Applies ALL schema migrations needed for the activity-inventory
# tests (A1-A20 + migration forward/rollback) to a blank postgres:15
# instance. This is the ONLY place schema is bootstrapped for CI.
#
# Strategy:
#   - Run 0001..17 in order to create all production tables
#   - Add claimed_count column to task_progress (production has it; not yet
#     captured in a numbered migration file — added here as a CI-only patch)
#   - Add user_activity_stats table (production has it; same situation)
#   - After all migrations run, execute the target migration
#     (2026-09-22-0001_activity_scoped_inventory.sql)
#   - Rollback test drops and recreates the new table only
#
# DO NOT run this on production.
# ============================================================

-- ── 0001: initial schema ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY,
    total_damage_dealt INT DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.user_inventory (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    item_hand INT DEFAULT 0 NOT NULL,
    item_phallus INT DEFAULT 0 NOT NULL,
    last_reset_date DATE DEFAULT CURRENT_DATE NOT NULL,
    task_consume_count INT DEFAULT 0 NOT NULL,
    task_recharge_count INT DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.global_boss (
    id SERIAL PRIMARY KEY,
    total_hp INT NOT NULL,
    current_hp INT NOT NULL,
    current_stage INT DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.attack_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) NOT NULL,
    item_used TEXT NOT NULL CHECK (item_used IN ('item_hand', 'item_phallus')),
    damage_dealt INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.milestone_rewards (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) NOT NULL,
    milestone_threshold INT NOT NULL,
    reward_type TEXT NOT NULL CHECK (reward_type IN ('battery', 'badge')),
    claimed_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ── 01: task/daily schema ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_daily_tasks (
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    date DATE DEFAULT CURRENT_DATE NOT NULL,
    daily_energy_consumed INT DEFAULT 0 NOT NULL,
    daily_money_recharged NUMERIC(12, 2) DEFAULT 0 NOT NULL,
    PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS public.webhook_idempotency (
    tx_id TEXT PRIMARY KEY,
    processed_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ── 02: battle system schema ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.boss_status (
    boss_id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
    max_hp BIGINT NOT NULL DEFAULT 100000,
    current_hp BIGINT NOT NULL DEFAULT 100000,
    version INTEGER NOT NULL DEFAULT 1,
    last_updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    CONSTRAINT positive_hp CHECK (current_hp >= 0),
    CONSTRAINT max_hp_limit CHECK (current_hp <= max_hp)
);

INSERT INTO public.boss_status (boss_id, max_hp, current_hp, version)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, 100000, 100000, 1
WHERE NOT EXISTS (SELECT 1 FROM public.boss_status WHERE boss_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- user_inventory (revised columns)
CREATE TABLE IF NOT EXISTS public.user_inventory (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    item_hand_count INTEGER NOT NULL DEFAULT 0 CHECK (item_hand_count >= 0),
    item_phallus_count INTEGER NOT NULL DEFAULT 0 CHECK (item_phallus_count >= 0),
    total_damage_dealt BIGINT NOT NULL DEFAULT 0 CHECK (total_damage_dealt >= 0),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- user_activity_stats (production table; referenced by pg.ts getActivityDamage + persistAttackTransactionally)
CREATE TABLE IF NOT EXISTS public.user_activity_stats (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    activity_id INTEGER NOT NULL,
    total_damage BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (user_id, activity_id)
);

-- attack_logs (revised columns)
CREATE TABLE IF NOT EXISTS public.attack_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    item_used VARCHAR(20) NOT NULL CHECK (item_used IN ('item_hand', 'item_phallus')),
    damage_dealt BIGINT NOT NULL DEFAULT 0 CHECK (damage_dealt >= 0),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- task_progress
CREATE TABLE IF NOT EXISTS public.task_progress (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    task_type VARCHAR(50) NOT NULL CHECK (task_type IN ('daily_energy', 'daily_recharge')),
    reset_date DATE NOT NULL DEFAULT CURRENT_DATE,
    current_progress INTEGER NOT NULL DEFAULT 0,
    is_claimed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (user_id, task_type, reset_date)
);

-- milestone_rewards (revised)
CREATE TABLE IF NOT EXISTS public.milestone_rewards (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    milestone_id INTEGER NOT NULL CHECK (milestone_id IN (75, 50, 25)),
    is_claimed BOOLEAN NOT NULL DEFAULT false,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (user_id, milestone_id)
);

-- trigger helper
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = timezone('utc'::text, now()); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_user_inventory_updated_at ON public.user_inventory;
CREATE TRIGGER update_user_inventory_updated_at
    BEFORE UPDATE ON public.user_inventory
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_task_progress_updated_at ON public.task_progress;
CREATE TRIGGER update_task_progress_updated_at
    BEFORE UPDATE ON public.task_progress
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_activity_stats_updated_at ON public.user_activity_stats;
CREATE TRIGGER update_user_activity_stats_updated_at
    BEFORE UPDATE ON public.user_activity_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 03: activities table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('LIVE2D', 'ENERGY')),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'DISABLED' CHECK (status IN ('ENABLED', 'DISABLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 04: activities.config ─────────────────────────────────────────────────
ALTER TABLE public.activities
    ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{"isGlobalEnabled": false}'::jsonb;

-- ── 05: banners ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.banners (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    image_url TEXT NOT NULL DEFAULT '',
    redirect_id TEXT NOT NULL DEFAULT '',
    redirect_type TEXT NOT NULL DEFAULT 'none'
        CHECK (redirect_type IN ('activity', 'external', 'none')),
    is_active BOOLEAN NOT NULL DEFAULT false,
    show_countdown BOOLEAN NOT NULL DEFAULT false,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.activities (id, name, type, start_time, end_time, status, config)
VALUES (999999, '__banner_global__', 'LIVE2D', '2026-01-01T00:00:00Z', '2099-12-31T23:59:59Z',
        'DISABLED', '{"isGlobalEnabled": false}')
ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config;

-- ── 06: users columns + audit ──────────────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS nickname TEXT DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT '👤';

ALTER TABLE public.milestone_rewards ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.milestone_rewards ADD COLUMN IF NOT EXISTS reward_type TEXT CHECK (reward_type IN ('ENERGY', 'MEDAL')) DEFAULT 'MEDAL';
ALTER TABLE public.milestone_rewards ADD COLUMN IF NOT EXISTS reward_value TEXT DEFAULT '挑战勋章';

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
    id BIGSERIAL PRIMARY KEY,
    route TEXT NOT NULL,
    action TEXT NOT NULL,
    operator_id TEXT NOT NULL,
    target_user_id TEXT NOT NULL,
    field_name TEXT,
    old_value TEXT,
    new_value TEXT,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 07: task claim lock ────────────────────────────────────────────────────
ALTER TABLE public.user_daily_tasks ADD COLUMN IF NOT EXISTS recharge_processed BOOLEAN NOT NULL DEFAULT false;

-- ── 08: activity cleanup (pg_cron skipped in CI) ──────────────────────────
-- No-op in CI; pg_cron extension not loaded in test PG

-- ── 09: milestone claim RPC ────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_milestone_rewards_unclaimed
    ON public.milestone_rewards (user_id, milestone_id) WHERE is_claimed = false;

-- ── 10: milestone lock column (secondary pass; already done in 06) ──────────
-- safe to re-run

-- ── 11: webhook atomic RPC ────────────────────────────────────────────────
ALTER TABLE public.user_daily_tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

-- ── 12: personal milestone RPC (DEPRECATED — still creates table) ───────────
-- table already exists from 06

-- ── 13: bulk milestone finalizer ───────────────────────────────────────────
-- function only; no new tables

-- ── 14: updated_at fix ────────────────────────────────────────────────────
ALTER TABLE public.task_progress ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

-- ── 15: webhook audit ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_audit (
    id BIGSERIAL PRIMARY KEY,
    tx_id TEXT,
    action_type TEXT,
    user_id TEXT,
    raw_user_id TEXT,
    client_ip TEXT,
    duration_ms INTEGER,
    http_status INTEGER,
    success BOOLEAN NOT NULL DEFAULT false,
    result TEXT,
    error_code TEXT,
    error_message TEXT,
    raw_body TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 16: badges table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.badges (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    thumbnail TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.touch_badges_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_badges_updated_at ON public.badges;
CREATE TRIGGER trg_badges_updated_at BEFORE UPDATE ON public.badges
    FOR EACH ROW EXECUTE FUNCTION public.touch_badges_updated_at();

-- ── 17: milestone admin bypass ─────────────────────────────────────────────
ALTER TABLE public.milestone_rewards ADD COLUMN IF NOT EXISTS admin_bypass BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.milestone_rewards ADD COLUMN IF NOT EXISTS admin_bypass_source TEXT DEFAULT null;

-- ════════════════════════════════════════════════════════════════════════════════
-- CI-ONLY PATCHES (production has these; migrations not yet captured)
-- These columns/tables exist in production RDS but are missing from the
-- numbered migration chain. Adding them here so CI schema matches production.
-- ════════════════════════════════════════════════════════════════════════════════

-- claimed_count on task_progress — production has this (task-claim/route.ts reads it)
ALTER TABLE public.task_progress ADD COLUMN IF NOT EXISTS claimed_count INTEGER NOT NULL DEFAULT 0;

-- user_activity_stats trigger (already created above but double-check)
DROP TRIGGER IF EXISTS update_user_activity_stats_updated_at ON public.user_activity_stats;
CREATE TRIGGER update_user_activity_stats_updated_at
    BEFORE UPDATE ON public.user_activity_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ════════════════════════════════════════════════════════════════════════════════
-- Seed minimal test fixture: activities 1 and 8
-- These IDs match the test scenarios (activity1, activity8)
-- ════════════════════════════════════════════════════════════════════════════════
INSERT INTO public.activities (id, name, type, start_time, end_time, status, config)
VALUES
    (1, '测试活动1', 'LIVE2D',
     '2026-01-01T00:00:00Z', '2099-12-31T23:59:59Z', 'DISABLED',
     '{"isGlobalEnabled": false, "items": {"propA": {"name": "闪电符文", "taskThreshold": 100, "dailyLimit": 5}, "propB": {"name": "潮汐晶石", "taskThreshold": 100, "dailyLimit": 5}}}'),
    (8, '测试活动8', 'LIVE2D',
     '2026-01-01T00:00:00Z', '2099-12-31T23:59:59Z', 'DISABLED',
     '{"isGlobalEnabled": false, "items": {"propA": {"name": "闪电符文", "taskThreshold": 100, "dailyLimit": 5}, "propB": {"name": "潮汐晶石", "taskThreshold": 100, "dailyLimit": 5}}}')
ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Prerequisite gate (added in Run #2 fix):
--   These are the exact tables the
--   supabase/migrations/2026-09-22-0001_activity_scoped_inventory.sql
--   migration depends on:
--       public.users           → FK target of user_activity_inventory.user_id
--       public.activities      → FK target of user_activity_inventory.activity_id
--       public.user_inventory  → legacy companion table (kept for legacy reads)
--       public.user_activity_stats  → read by persistAttackTransactionally
--       public.task_progress          → read by task-claim/route.ts
--       public.user_daily_tasks       → read by webhook/daily route
--       public.attack_logs            → re-created above as needed
--   If any of these is missing, the migration forward step WILL fail with
--   "relation ... does not exist". This DO block must FAIL THE STEP LOUDLY
--   (RAISE EXCEPTION + psql ON_ERROR_STOP=1 in the workflow) so we don't
--   get a green bootstrap + downstream red migration.
-- ═══════════════════════════════════════════════════════════════════════════════
DO $prereq$
DECLARE
    missing text[] := ARRAY[]::text[];
    label text;
    rc regclass;
BEGIN
    FOR label IN
        SELECT unnest(ARRAY[
            'users',
            'activities',
            'user_inventory',
            'user_activity_stats',
            'task_progress',
            'user_daily_tasks',
            'attack_logs'
        ])
    LOOP
        rc := to_regclass('public.' || label);
        IF rc IS NULL THEN
            missing := array_append(missing, label);
        END IF;
    END LOOP;

    IF array_length(missing, 1) > 0 THEN
        RAISE EXCEPTION
            'CI bootstrap prerequisite FAILED — missing tables: %',
            array_to_string(missing, ', ');
    END IF;

    RAISE NOTICE 'CI bootstrap prerequisite OK — all 7 migration-required tables present';
END
$prereq$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Verify: all required tables exist (original broader sweep)
-- ════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    tbl text;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY[
            'users','user_inventory','user_activity_stats','user_daily_tasks',
            'task_progress','attack_logs','activities','milestone_rewards',
            'boss_status','badges','admin_audit_log','webhook_audit',
            'banners','webhook_idempotency'
        ])
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name=tbl
        ) THEN
            RAISE EXCEPTION 'MISSING TABLE: %', tbl;
        END IF;
    END LOOP;
    RAISE NOTICE 'CI bootstrap OK — all % tables present', 14;
END $$;
