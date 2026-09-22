-- =============================================================================
-- Migration: aws_09_user_alias.sql
-- Description: Restores repository parity for public.user_alias.
--
-- Background:
--   The user_alias table was created directly on the production RDS instance
--   outside the tracked migration path (no CREATE TABLE exists in either
--   supabase/migrations/ or aws_rds_init/).  Live introspection of the
--   production catalog confirmed the contract on 2026-09-01.
--
--   This migration is the repository's source-of-truth record of that
--   contract. It is intentionally MINIMAL — it mirrors production exactly
--   and does NOT introduce any new behavior.
--
-- Production contract (live-verified 2026-09-01):
--   columns:
--     alias_type   TEXT        NOT NULL
--     alias_value  TEXT        NOT NULL
--     uuid         UUID        NOT NULL
--     created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
--   primary key:
--     (alias_type, alias_value)
--   indexes:
--     user_alias_pkey          UNIQUE BTREE (alias_type, alias_value)
--     ix_user_alias_uuid       BTREE (uuid)
--   foreign keys: none
--   row level security: disabled
--   policies: none
--   owner: postgres
--
-- This file does NOT introduce any of the following (production has none):
--   * cross-table referential link from user_alias.uuid into public.users(id)
--   * additional UNIQUE constraint on the uuid column
--   * partial / conditional indexes
--   * row-level triggers on the table
--   * CHECK predicates on any column
--   * row-level security activation
--   * policy objects bound to the table
--   * explicit GRANT statements (owner-only privileges already apply)
--
-- Idempotent. Safe to re-run on a fresh RDS environment.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_alias (
  alias_type  TEXT        NOT NULL,
  alias_value TEXT        NOT NULL,
  uuid        UUID        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (alias_type, alias_value)
);

CREATE INDEX IF NOT EXISTS ix_user_alias_uuid
  ON public.user_alias (uuid);
