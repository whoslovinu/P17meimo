CREATE INDEX IF NOT EXISTS idx_user_inventory_damage
  ON public.user_inventory (total_damage_dealt DESC);

CREATE INDEX IF NOT EXISTS idx_boss_status_hp
  ON public.boss_status (current_hp)
  WHERE boss_id = '00000000-0000-0000-0000-000000000001'::uuid;

CREATE INDEX IF NOT EXISTS idx_attack_logs_user_id
  ON public.attack_logs (user_id);

CREATE INDEX IF NOT EXISTS idx_attack_logs_created_at
  ON public.attack_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_daily_tasks_user_date
  ON public.user_daily_tasks (user_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_user_daily_tasks_processed
  ON public.user_daily_tasks (user_id, date, recharge_processed)
  WHERE recharge_processed = FALSE;

CREATE INDEX IF NOT EXISTS idx_webhook_idempotency_processed_at
  ON public.webhook_idempotency (processed_at);

CREATE INDEX IF NOT EXISTS idx_task_progress_reset_date
  ON public.task_progress (reset_date DESC);

CREATE INDEX IF NOT EXISTS idx_task_progress_claimable
  ON public.task_progress (user_id, reset_date, is_claimed)
  WHERE is_claimed = FALSE;

CREATE INDEX IF NOT EXISTS idx_milestone_rewards_claimable
  ON public.milestone_rewards (user_id, is_claimed)
  WHERE is_claimed = FALSE;

CREATE INDEX IF NOT EXISTS idx_milestone_rewards_locked
  ON public.milestone_rewards (is_locked)
  WHERE is_locked = TRUE;

CREATE INDEX IF NOT EXISTS idx_attack_idempotency_expires
  ON public.attack_idempotency (processed_at);

CREATE UNIQUE INDEX IF NOT EXISTS activities_name_active_window
  ON public.activities (name, start_time, end_time)
  WHERE status = 'ENABLED';

CREATE INDEX IF NOT EXISTS activities_config_idx
  ON public.activities ((config->>'isGlobalEnabled'))
  WHERE config IS NOT NULL;

CREATE INDEX IF NOT EXISTS banners_is_active_idx
  ON public.banners (is_active)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS banners_sort_order_idx
  ON public.banners (sort_order);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target_user
  ON public.admin_audit_log (target_user_id);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action
  ON public.admin_audit_log (action);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at
  ON public.admin_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_user_time
  ON public.admin_audit_log (target_user_id, created_at DESC);

-- user_activity_stats indexes
CREATE INDEX IF NOT EXISTS idx_user_activity_stats_activity_id
  ON public.user_activity_stats (activity_id);

CREATE INDEX IF NOT EXISTS idx_user_activity_stats_activity_damage
  ON public.user_activity_stats (activity_id, total_damage DESC);
