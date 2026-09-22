-- Migration: aws_06_repark_config.sql
-- Generic key/value JSON config table backing the admin config endpoints
-- (Spine / Live2D / damage-weights). Redis is the hot cache; PostgreSQL is
-- the durable backup so the values survive a Redis flush.

CREATE TABLE IF NOT EXISTS public.repark_config (
  key         TEXT PRIMARY KEY,
  config_json JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_repark_config_updated_at
  ON public.repark_config (updated_at DESC);