-- =============================================================================
-- Migration: 02_battle_system_schema.sql
-- Description: Phase 1 - Industrial Grade Battle System Schema
--              Replaces legacy global_boss with proper boss_status table
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: boss_status
-- Single source of truth for global boss HP with optimistic locking
-- -----------------------------------------------------------------------------
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

-- Index for fast HP reads
CREATE INDEX IF NOT EXISTS idx_boss_status_hp 
    ON public.boss_status (current_hp) WHERE boss_id = '00000000-0000-0000-0000-000000000001'::uuid;

-- Seed initial boss (only if table is empty)
INSERT INTO public.boss_status (boss_id, max_hp, current_hp, version)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, 100000, 100000, 1
WHERE NOT EXISTS (SELECT 1 FROM public.boss_status WHERE boss_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- -----------------------------------------------------------------------------
-- TABLE: user_inventory
-- User items and cumulative damage tracking
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_inventory (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    item_hand_count INTEGER NOT NULL DEFAULT 0 CHECK (item_hand_count >= 0),
    item_phallus_count INTEGER NOT NULL DEFAULT 0 CHECK (item_phallus_count >= 0),
    total_damage_dealt BIGINT NOT NULL DEFAULT 0 CHECK (total_damage_dealt >= 0),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Index for leaderboard queries
CREATE INDEX IF NOT EXISTS idx_user_inventory_damage 
    ON public.user_inventory (total_damage_dealt DESC);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_user_inventory_updated_at ON public.user_inventory;
CREATE TRIGGER update_user_inventory_updated_at
    BEFORE UPDATE ON public.user_inventory
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- TABLE: attack_logs
-- Immutable audit log of all attacks
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attack_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    item_used VARCHAR(20) NOT NULL CHECK (item_used IN ('item_hand', 'item_phallus')),
    damage_dealt BIGINT NOT NULL DEFAULT 0 CHECK (damage_dealt >= 0),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Index for user attack history queries
CREATE INDEX IF NOT EXISTS idx_attack_logs_user_id ON public.attack_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_attack_logs_created_at ON public.attack_logs (created_at DESC);

-- -----------------------------------------------------------------------------
-- TABLE: task_progress
-- Tracks daily task progress and claim status
-- -----------------------------------------------------------------------------
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

-- Index for daily task queries
CREATE INDEX IF NOT EXISTS idx_task_progress_reset_date 
    ON public.task_progress (reset_date DESC);

CREATE INDEX IF NOT EXISTS idx_task_progress_claimable 
    ON public.task_progress (user_id, reset_date, is_claimed) 
    WHERE is_claimed = false;

DROP TRIGGER IF EXISTS update_task_progress_updated_at ON public.task_progress;
CREATE TRIGGER update_task_progress_updated_at
    BEFORE UPDATE ON public.task_progress
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- TABLE: milestone_rewards
-- Tracks claimed milestone rewards (75%, 50%, 25% HP thresholds)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.milestone_rewards (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    milestone_id INTEGER NOT NULL CHECK (milestone_id IN (75, 50, 25)),
    is_claimed BOOLEAN NOT NULL DEFAULT false,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (user_id, milestone_id)
);

-- Index for checking unclaimed milestones
CREATE INDEX IF NOT EXISTS idx_milestone_rewards_unclaimed 
    ON public.milestone_rewards (user_id, is_claimed) 
    WHERE is_claimed = false;

-- -----------------------------------------------------------------------------
-- TABLE: attack_idempotency
-- Prevents duplicate attack processing (server-side nonce enforcement)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attack_idempotency (
    idempotency_key TEXT PRIMARY KEY,
    processed_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Auto-cleanup: delete keys older than 24 hours (run via cron)
CREATE INDEX IF NOT EXISTS idx_attack_idempotency_expires 
    ON public.attack_idempotency (processed_at);

-- -----------------------------------------------------------------------------
-- RLS POLICIES (Service Role Bypass for Admin API)
-- -----------------------------------------------------------------------------
ALTER TABLE public.boss_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attack_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestone_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attack_idempotency ENABLE ROW LEVEL SECURITY;

-- Service role full access policies
DROP POLICY IF EXISTS "service_role_full_access_boss" ON public.boss_status;
CREATE POLICY "service_role_full_access_boss" ON public.boss_status FOR ALL USING (true);

DROP POLICY IF EXISTS "service_role_full_access_inventory" ON public.user_inventory;
CREATE POLICY "service_role_full_access_inventory" ON public.user_inventory FOR ALL USING (true);

DROP POLICY IF EXISTS "service_role_full_access_attack_logs" ON public.attack_logs;
CREATE POLICY "service_role_full_access_attack_logs" ON public.attack_logs FOR ALL USING (true);

DROP POLICY IF EXISTS "service_role_full_access_tasks" ON public.task_progress;
CREATE POLICY "service_role_full_access_tasks" ON public.task_progress FOR ALL USING (true);

DROP POLICY IF EXISTS "service_role_full_access_milestones" ON public.milestone_rewards;
CREATE POLICY "service_role_full_access_milestones" ON public.milestone_rewards FOR ALL USING (true);

DROP POLICY IF EXISTS "service_role_full_access_idempotency" ON public.attack_idempotency;
CREATE POLICY "service_role_full_access_idempotency" ON public.attack_idempotency FOR ALL USING (true);

-- -----------------------------------------------------------------------------
-- MIGRATION HELPER: Function to increment boss version atomically
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_boss_version(target_boss_id UUID)
RETURNS INTEGER AS $$
DECLARE
    new_version INTEGER;
BEGIN
    UPDATE public.boss_status 
    SET version = version + 1, 
        last_updated_at = timezone('utc'::text, now())
    WHERE boss_id = target_boss_id
    RETURNING version INTO new_version;
    
    RETURN new_version;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- MIGRATION HELPER: Function to add user damage atomically
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION add_user_damage(p_user_id UUID, p_damage BIGINT)
RETURNS VOID AS $$
BEGIN
    INSERT INTO public.user_inventory (user_id, item_hand_count, item_phallus_count, total_damage_dealt)
    VALUES (p_user_id, 0, 0, p_damage)
    ON CONFLICT (user_id) 
    DO UPDATE SET 
        total_damage_dealt = user_inventory.total_damage_dealt + p_damage,
        updated_at = timezone('utc'::text, now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION increment_boss_version(UUID) TO SERVICE_ROLE;
GRANT EXECUTE ON FUNCTION add_user_damage(UUID, BIGINT) TO SERVICE_ROLE;

-- -----------------------------------------------------------------------------
-- MIGRATION HELPER: Function to increment item count atomically
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_item_count(
  p_user_id UUID,
  p_item_type TEXT,
  p_amount INTEGER DEFAULT 1
)
RETURNS VOID AS $$
BEGIN
  IF p_item_type = 'item_hand' THEN
    UPDATE public.user_inventory 
    SET item_hand_count = item_hand_count + p_amount,
        updated_at = timezone('utc'::text, now())
    WHERE user_id = p_user_id;
  ELSIF p_item_type = 'item_phallus' THEN
    UPDATE public.user_inventory 
    SET item_phallus_count = item_phallus_count + p_amount,
        updated_at = timezone('utc'::text, now())
    WHERE user_id = p_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION increment_item_count(UUID, TEXT, INTEGER) TO SERVICE_ROLE;

-- -----------------------------------------------------------------------------
-- MIGRATION HELPER: Ensure legacy global_boss table has required data
-- (For backward compatibility during migration period)
-- -----------------------------------------------------------------------------
INSERT INTO public.global_boss (id, total_hp, current_hp, current_stage)
SELECT 1, 100000, 100000, 1
WHERE NOT EXISTS (SELECT 1 FROM public.global_boss WHERE id = 1);

-- -----------------------------------------------------------------------------
-- GRANT PERMISSIONS
-- -----------------------------------------------------------------------------
GRANT ALL ON ALL TABLES IN SCHEMA public TO SERVICE_ROLE;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO SERVICE_ROLE;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO SERVICE_ROLE;
