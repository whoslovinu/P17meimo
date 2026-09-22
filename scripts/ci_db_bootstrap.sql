-- ============================================================
-- CI Bootstrap SQL — P17 Activity Inventory DB Gate
-- ============================================================
-- Applies ALL schema migrations needed for the activity-inventory
-- tests (A1-A20 + migration forward/rollback) to a blank postgres:15
-- instance. This is the ONLY place schema is bootstrapped for CI.
--
-- Strategy:
--   - Mirror production schema as captured in aws_rds_init/aws_01_schema.sql
--     (canonical production shape for milestone_rewards, user_inventory,
--     attack_logs, activities, etc.)
--   - Add claimed_count column to task_progress (production has it; not yet
--     captured in a numbered migration file — added here as a CI-only patch)
--   - Add user_activity_stats table (production has it; same situation)
--   - After all schemas exist, execute the target migration
--     (2026-09-22-0001_activity_scoped_inventory.sql)
--   - Rollback test drops and recreates the new table only
--
-- Defensive: any table that has historically had competing CREATE TABLE
-- definitions is DROPPED before re-creation, so this script is idempotent
-- even on a stale CI database from a previously-failed run.
--
-- DO NOT run this on production.
-- ============================================================

-- pgcrypto is required for gen_random_uuid() in some Postgres builds.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ────────────────────────────────────────────────────────────────────────────
-- Defensive DROP:  these three tables historically had two competing CREATE
-- TABLE definitions in earlier revisions of this file.  On a stale CI
-- database, the WRONG (pre-migration-02) shape may already exist.  We drop
-- first so the canonical (production-shape) CREATE below always wins.
-- ────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.user_inventory      CASCADE;
DROP TABLE IF EXISTS public.attack_logs         CASCADE;
DROP TABLE IF EXISTS public.milestone_rewards   CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- CORE TABLES — shape mirrored from aws_rds_init/aws_01_schema.sql
-- (production-equivalent schema)
-- ════════════════════════════════════════════════════════════════════════════

-- ── users (production-equivalent) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY,
    total_damage_dealt BIGINT NOT NULL DEFAULT 0 CHECK (total_damage_dealt >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    email TEXT NOT NULL DEFAULT '',
    nickname TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT '👤'
);

-- ── user_inventory (production-equivalent; was v1+IF NOT EXISTS+v2 before)
CREATE TABLE IF NOT EXISTS public.user_inventory (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    item_hand_count INTEGER NOT NULL DEFAULT 0 CHECK (item_hand_count >= 0),
    item_phallus_count INTEGER NOT NULL DEFAULT 0 CHECK (item_phallus_count >= 0),
    total_damage_dealt BIGINT NOT NULL DEFAULT 0 CHECK (total_damage_dealt >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ── boss_status ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.boss_status (
    boss_id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
    max_hp BIGINT NOT NULL DEFAULT 100000 CHECK (max_hp >= 0),
    current_hp BIGINT NOT NULL DEFAULT 100000 CHECK (current_hp >= 0),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT boss_status_hp_limit CHECK (current_hp <= max_hp)
);

-- ── attack_logs (production-equivalent) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attack_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    item_used VARCHAR(20) NOT NULL CHECK (item_used IN ('item_hand', 'item_phallus')),
    damage_dealt BIGINT NOT NULL DEFAULT 0 CHECK (damage_dealt >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ── milestone_rewards (production-equivalent; was v1+IF NOT EXISTS+v2 before)
-- Production shape from aws_01_schema.sql line 66. Critical columns:
--   is_claimed  BOOLEAN   — referenced by all claim routes & RPCs
--   is_locked   BOOLEAN   — admin-locked guard
--   reward_type TEXT      — 'ENERGY' | 'MEDAL'
--   reward_value TEXT     — display label
--   milestone_id INTEGER  — replaces v1 milestone_threshold
CREATE TABLE IF NOT EXISTS public.milestone_rewards (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    milestone_id INTEGER NOT NULL,
    is_claimed BOOLEAN NOT NULL DEFAULT false,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    is_locked BOOLEAN NOT NULL DEFAULT false,
    reward_type TEXT NOT NULL DEFAULT 'MEDAL' CHECK (reward_type IN ('ENERGY', 'MEDAL')),
    reward_value TEXT NOT NULL DEFAULT '挑战勋章',
    PRIMARY KEY (user_id, milestone_id),
    CONSTRAINT milestone_rewards_locked_guard CHECK (
        NOT (is_locked = true AND is_claimed = true AND claimed_at IS NOT NULL)
    )
);

-- ── user_daily_tasks ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_daily_tasks (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    daily_energy_consumed INT NOT NULL DEFAULT 0 CHECK (daily_energy_consumed >= 0),
    daily_money_recharged NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (daily_money_recharged >= 0),
    recharge_processed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (user_id, date)
);

-- ── webhook_idempotency ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_idempotency (
    tx_id TEXT PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ── task_progress ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_progress (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    task_type VARCHAR(50) NOT NULL CHECK (task_type IN ('daily_energy', 'daily_recharge')),
    reset_date DATE NOT NULL DEFAULT CURRENT_DATE,
    current_progress INTEGER NOT NULL DEFAULT 0 CHECK (current_progress >= 0),
    is_claimed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (user_id, task_type, reset_date)
);

-- ── attack_idempotency (production has it; referenced by some prod routes) ──
CREATE TABLE IF NOT EXISTS public.attack_idempotency (
    idempotency_key TEXT PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ── activities (with config JSONB column baked in — matches aws_01) ───────
CREATE TABLE IF NOT EXISTS public.activities (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('LIVE2D', 'ENERGY')),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'DISABLED' CHECK (status IN ('ENABLED', 'DISABLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    config JSONB NOT NULL DEFAULT '{"isGlobalEnabled": false}'::jsonb,
    CONSTRAINT activities_end_after_start CHECK (end_time > start_time)
);

-- ── banners ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.banners (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    image_url TEXT NOT NULL DEFAULT '',
    redirect_id TEXT NOT NULL DEFAULT '',
    redirect_type TEXT NOT NULL DEFAULT 'none' CHECK (redirect_type IN ('activity', 'external', 'none')),
    is_active BOOLEAN NOT NULL DEFAULT false,
    show_countdown BOOLEAN NOT NULL DEFAULT false,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── admin_audit_log ─────────────────────────────────────────────────────────
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

-- ── webhook_audit ───────────────────────────────────────────────────────────
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

-- ── badges ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.badges (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    thumbnail TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── global_boss (legacy table; created in 0001) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.global_boss (
    id SERIAL PRIMARY KEY,
    total_hp INT NOT NULL,
    current_hp INT NOT NULL,
    current_stage INT DEFAULT 1 NOT NULL
);

-- ── user_activity_stats (production table; referenced by pg.ts getActivityDamage + persistAttackTransactionally)
CREATE TABLE IF NOT EXISTS public.user_activity_stats (
    user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    activity_id  INTEGER NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
    total_damage BIGINT NOT NULL DEFAULT 0 CHECK (total_damage >= 0),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (user_id, activity_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- UPDATE updated_at TRIGGER HELPER + PER-TABLE TRIGGERS
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_user_inventory_updated_at   ON public.user_inventory;
CREATE TRIGGER update_user_inventory_updated_at
    BEFORE UPDATE ON public.user_inventory
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_daily_tasks_updated_at ON public.user_daily_tasks;
CREATE TRIGGER update_user_daily_tasks_updated_at
    BEFORE UPDATE ON public.user_daily_tasks
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_task_progress_updated_at   ON public.task_progress;
CREATE TRIGGER update_task_progress_updated_at
    BEFORE UPDATE ON public.task_progress
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_activity_stats_updated_at ON public.user_activity_stats;
CREATE TRIGGER update_user_activity_stats_updated_at
    BEFORE UPDATE ON public.user_activity_stats
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ════════════════════════════════════════════════════════════════════════════
-- Seed minimal test fixture: activities 1 and 8
-- These IDs match the test scenarios (activity1, activity8)
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.activities (id, name, type, start_time, end_time, status, config)
VALUES
    (1, '测试活动1', 'LIVE2D',
     '2026-01-01T00:00:00Z', '2099-12-31T23:59:59Z', 'DISABLED',
     '{"isGlobalEnabled": false, "items": {"propA": {"name": "闪电符文", "taskThreshold": 100, "dailyLimit": 5}, "propB": {"name": "潮汐晶石", "taskThreshold": 100, "dailyLimit": 5}}}'),
    (8, '测试活动8', 'LIVE2D',
     '2026-01-01T00:00:00Z', '2099-12-31T23:59:59Z', 'DISABLED',
     '{"isGlobalEnabled": false, "items": {"propA": {"name": "闪电符文", "taskThreshold": 100, "dailyLimit": 5}, "propB": {"name": "潮汐晶石", "taskThreshold": 100, "dailyLimit": 5}}}')
ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config;

-- ════════════════════════════════════════════════════════════════════════════
-- CI-ONLY PATCHES (production has these; migrations not yet captured)
-- These columns/tables exist in production RDS but are missing from the
-- numbered migration chain. Adding them here so CI schema matches production.
-- ════════════════════════════════════════════════════════════════════════════

-- claimed_count on task_progress — production has this (task-claim/route.ts reads it)
ALTER TABLE public.task_progress ADD COLUMN IF NOT EXISTS claimed_count INTEGER NOT NULL DEFAULT 0;

-- admin_bypass + admin_bypass_source on milestone_rewards (migration 17 — production)
ALTER TABLE public.milestone_rewards ADD COLUMN IF NOT EXISTS admin_bypass          BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.milestone_rewards ADD COLUMN IF NOT EXISTS admin_bypass_source  TEXT    DEFAULT NULL;

-- is_locked index — production has it (migration 10)
CREATE INDEX IF NOT EXISTS idx_milestone_rewards_locked
    ON public.milestone_rewards ((is_locked))
    WHERE is_locked = true;

-- admin_bypass index — production has it (migration 17)
CREATE INDEX IF NOT EXISTS idx_milestone_rewards_admin_bypass
    ON public.milestone_rewards (user_id)
    WHERE admin_bypass = TRUE;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTIAL UNIQUE INDEX for milestone_rewards — referenced by line 222 of
-- earlier revisions.  Must be created AFTER the table has is_claimed column.
-- ════════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS idx_milestone_rewards_unclaimed
    ON public.milestone_rewards (user_id, milestone_id) WHERE is_claimed = false;

-- ════════════════════════════════════════════════════════════════════════════
-- Prerequisite gate (added in Run #2 fix, expanded in Run #4):
--   These are the exact TABLES the
--   supabase/migrations/2026-09-22-0001_activity_scoped_inventory.sql
--   migration depends on:
--       public.users           → FK target of user_activity_inventory.user_id
--       public.activities      → FK target of user_activity_inventory.activity_id
--       public.user_inventory  → legacy companion table (kept for legacy reads)
--       public.user_activity_stats  → read by persistAttackTransactionally
--       public.task_progress          → read by task-claim/route.ts
--       public.user_daily_tasks       → read by webhook/daily route
--       public.attack_logs            → written by persistAttackTransactionally
--       public.milestone_rewards      → claim RPC (production helper)
-- ════════════════════════════════════════════════════════════════════════════
DO $prereq$
DECLARE
    missing_tables text[] := ARRAY[]::text[];
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
            'attack_logs',
            'milestone_rewards'
        ])
    LOOP
        rc := to_regclass('public.' || label);
        IF rc IS NULL THEN
            missing_tables := array_append(missing_tables, label);
        END IF;
    END LOOP;

    IF array_length(missing_tables, 1) > 0 THEN
        RAISE EXCEPTION
            'CI bootstrap prerequisite FAILED — missing tables: %',
            array_to_string(missing_tables, ', ');
    END IF;

    RAISE NOTICE 'CI bootstrap prerequisite OK — all 8 migration-required tables present';
END
$prereq$;

-- ════════════════════════════════════════════════════════════════════════════
-- Column-level assertions (added in Run #4):
--   A1-A20 tests + production helpers (lib/db/pg.ts) require these columns.
--   If any is missing, the migration forward step WILL fail with cryptic
--   "column does not exist" or runtime errors. Surface them here, loudly.
-- ════════════════════════════════════════════════════════════════════════════
DO $colcheck$
DECLARE
    missing_cols text[] := ARRAY[]::text[];
    needle text;
    found int;
    -- 'schema.table.column' triples that the A1-A20 suite + pg.ts actually touch.
    -- Kept as flat text strings to avoid Postgres array-of-record ergonomics.
    needles text[] := ARRAY[
        -- production-equivalent schema columns (the migration's FK targets)
        'public.users.id',
        'public.users.nickname',
        'public.users.avatar',
        'public.activities.id',
        'public.activities.config',
        'public.activities.status',
        -- A1-A20 inventory columns
        'public.user_inventory.item_hand_count',
        'public.user_inventory.item_phallus_count',
        'public.user_inventory.total_damage_dealt',
        'public.user_activity_stats.user_id',
        'public.user_activity_stats.activity_id',
        'public.user_activity_stats.total_damage',
        'public.attack_logs.user_id',
        'public.attack_logs.item_used',
        'public.attack_logs.damage_dealt',
        'public.task_progress.is_claimed',
        'public.task_progress.claimed_count',
        'public.user_daily_tasks.recharge_processed',
        -- milestone columns referenced by production claim RPC + indexes
        'public.milestone_rewards.is_claimed',
        'public.milestone_rewards.is_locked',
        'public.milestone_rewards.reward_type',
        'public.milestone_rewards.reward_value',
        'public.milestone_rewards.admin_bypass'
    ];
BEGIN
    FOR i IN 1..array_length(needles, 1) LOOP
        needle := needles[i];
        SELECT COUNT(*) INTO found
          FROM information_schema.columns
         WHERE table_schema = split_part(needle, '.', 1)
           AND table_name   = split_part(needle, '.', 2)
           AND column_name  = split_part(needle, '.', 3);
        IF found = 0 THEN
            missing_cols := array_append(missing_cols, needle);
        END IF;
    END LOOP;

    IF array_length(missing_cols, 1) > 0 THEN
        RAISE EXCEPTION
            'CI bootstrap column check FAILED — missing columns: %',
            array_to_string(missing_cols, ', ');
    END IF;

    RAISE NOTICE 'CI bootstrap column check OK — all % critical columns present',
        array_length(needles, 1);
END
$colcheck$;

-- ════════════════════════════════════════════════════════════════════════════
-- Verify: every required table exists (broader sweep — kept for completeness)
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    tbl text;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY[
            'users','user_inventory','user_activity_stats','user_daily_tasks',
            'task_progress','attack_logs','activities','milestone_rewards',
            'boss_status','badges','admin_audit_log','webhook_audit',
            'banners','webhook_idempotency','attack_idempotency'
        ])
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name=tbl
        ) THEN
            RAISE EXCEPTION 'MISSING TABLE: %', tbl;
        END IF;
    END LOOP;
    RAISE NOTICE 'CI bootstrap OK — all 15 tables present';
END $$;
