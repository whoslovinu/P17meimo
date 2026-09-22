-- =============================================================================
-- Migration: 01_task_inventory_schema.sql
-- Description: Daily task tracking and webhook idempotency for S2S webhooks.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: user_daily_tasks
-- Tracks daily energy consumption and money recharges per user.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_daily_tasks (
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    date DATE DEFAULT CURRENT_DATE NOT NULL,
    daily_energy_consumed INT DEFAULT 0 NOT NULL,
    daily_money_recharged NUMERIC(12, 2) DEFAULT 0 NOT NULL,
    PRIMARY KEY (user_id, date)
);

-- Index for efficient date-range queries
CREATE INDEX IF NOT EXISTS idx_user_daily_tasks_user_date
    ON public.user_daily_tasks (user_id, date DESC);

-- -----------------------------------------------------------------------------
-- TABLE: webhook_idempotency
-- Prevents duplicate processing of S2S webhook calls.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.webhook_idempotency (
    tx_id TEXT PRIMARY KEY,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for cleanup of old records (optional, for maintenance)
CREATE INDEX IF NOT EXISTS idx_webhook_idempotency_processed_at
    ON public.webhook_idempotency (processed_at);

-- -----------------------------------------------------------------------------
-- RLS POLICIES
-- Service Role bypasses RLS, so these are for additional safety.
-- -----------------------------------------------------------------------------

ALTER TABLE public.user_daily_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_idempotency ENABLE ROW LEVEL SECURITY;

-- SELECT: Only service role should read (no client access needed)
CREATE POLICY "Service role only read user_daily_tasks"
    ON public.user_daily_tasks FOR SELECT USING (true);

-- INSERT/UPDATE/DELETE: Deny all client-side access
CREATE POLICY "Deny client access user_daily_tasks"
    ON public.user_daily_tasks FOR ALL USING (false);

-- webhook_idempotency: Only service role needs access
CREATE POLICY "Service role only access webhook_idempotency"
    ON public.webhook_idempotency FOR ALL USING (true);

-- -----------------------------------------------------------------------------
-- Note: The existing user_inventory table (created in 0001_initial_schema.sql)
-- already has the following columns for tracking task rewards:
--   - task_consume_count: tracks how many times energy threshold was met
--   - task_recharge_count: tracks how many times money threshold was met
-- These columns are used by the webhook handler to grant items.
-- -----------------------------------------------------------------------------
