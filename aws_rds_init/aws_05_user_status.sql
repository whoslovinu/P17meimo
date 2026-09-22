-- Migration: aws_05_user_status.sql
-- Adds account-status column to user_inventory and audit log table for
-- admin toggle_status functionality (H-2).
--
-- This migration is idempotent and safe to run on existing RDS instances.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.user_inventory
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'normal'
    CHECK (status IN ('normal', 'banned', 'locked'));

-- Drop and re-create the universal updated_at trigger to pick up the new column.
DROP TRIGGER IF EXISTS update_user_inventory_updated_at ON public.user_inventory;
CREATE TRIGGER update_user_inventory_updated_at
BEFORE UPDATE ON public.user_inventory
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_user_inventory_status
  ON public.user_inventory (status)
  WHERE status <> 'normal';
