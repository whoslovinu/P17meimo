-- =============================================================================
-- Migration: 0001_initial_schema.sql
-- Description: Core schema and RLS policies for Succubus Invasion event.
-- Notes: Supabase Service Role bypasses RLS automatically for backend mutations.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLES
-- -----------------------------------------------------------------------------

CREATE TABLE public.users (
    id UUID REFERENCES auth.users(id) PRIMARY KEY,
    total_damage_dealt INT DEFAULT 0 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.user_inventory (
    user_id UUID REFERENCES public.users(id) PRIMARY KEY,
    item_hand INT DEFAULT 0 NOT NULL,
    item_phallus INT DEFAULT 0 NOT NULL,
    last_reset_date DATE DEFAULT CURRENT_DATE NOT NULL,
    task_consume_count INT DEFAULT 0 NOT NULL,
    task_recharge_count INT DEFAULT 0 NOT NULL
);

CREATE TABLE public.global_boss (
    id SERIAL PRIMARY KEY,
    total_hp INT NOT NULL,
    current_hp INT NOT NULL,
    current_stage INT DEFAULT 1 NOT NULL
);

CREATE TABLE public.attack_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) NOT NULL,
    item_used TEXT NOT NULL CHECK (item_used IN ('item_hand', 'item_phallus')),
    damage_dealt INT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.milestone_rewards (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) NOT NULL,
    milestone_threshold INT NOT NULL,
    reward_type TEXT NOT NULL CHECK (reward_type IN ('battery', 'badge')),
    claimed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) ENABLEMENT
-- -----------------------------------------------------------------------------

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_boss ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attack_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestone_rewards ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- RLS POLICIES
-- -----------------------------------------------------------------------------

-- SELECT Policies: Clients can only read their own records.
CREATE POLICY "Users can read own data" ON public.users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can read own inventory" ON public.user_inventory
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Anyone can read boss state" ON public.global_boss
    FOR SELECT USING (true);

CREATE POLICY "Users can read own attack logs" ON public.attack_logs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can read own rewards" ON public.milestone_rewards
    FOR SELECT USING (auth.uid() = user_id);

-- INSERT/UPDATE/DELETE Policies: Explicitly deny all client-side writes.
-- Mutations are strictly restricted to the backend Service Role.

CREATE POLICY "Deny client insert inventory" ON public.user_inventory FOR INSERT WITH CHECK (false);
CREATE POLICY "Deny client update inventory" ON public.user_inventory FOR UPDATE USING (false);
CREATE POLICY "Deny client delete inventory" ON public.user_inventory FOR DELETE USING (false);

CREATE POLICY "Deny client insert attack logs" ON public.attack_logs FOR INSERT WITH CHECK (false);
CREATE POLICY "Deny client update attack logs" ON public.attack_logs FOR UPDATE USING (false);
CREATE POLICY "Deny client delete attack logs" ON public.attack_logs FOR DELETE USING (false);

CREATE POLICY "Deny client insert rewards" ON public.milestone_rewards FOR INSERT WITH CHECK (false);
CREATE POLICY "Deny client update rewards" ON public.milestone_rewards FOR UPDATE USING (false);
CREATE POLICY "Deny client delete rewards" ON public.milestone_rewards FOR DELETE USING (false);

CREATE POLICY "Deny client insert users" ON public.users FOR INSERT WITH CHECK (false);
CREATE POLICY "Deny client update users" ON public.users FOR UPDATE USING (false);
CREATE POLICY "Deny client delete users" ON public.users FOR DELETE USING (false);

CREATE POLICY "Deny client insert global boss" ON public.global_boss FOR INSERT WITH CHECK (false);
CREATE POLICY "Deny client update global boss" ON public.global_boss FOR UPDATE USING (false);
CREATE POLICY "Deny client delete global boss" ON public.global_boss FOR DELETE USING (false);
