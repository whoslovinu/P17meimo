-- Migration: P0 Activity-Scoped Inventory (2026-09-22)
-- Adds user_activity_inventory for per-(user, activity) item quantity isolation.
--
-- RATIONALE:
--   user_inventory must remain single-row-per-user because it stores globally-
--   scoped fields: total_damage_dealt (lifetime accumulator) and status (ban).
--   Item quantities (propA/propB) are activity-scoped and move to the new table.
--
-- MIGRATION STRATEGY (M3 — DUAL):
--   Existing global item counts in user_inventory are preserved AS ARCHIVAL DATA.
--   New writes (attack consume, task grant, admin adjust) go to the new table.
--   Read paths UNION the new table (takes precedence) with legacy fallback (=0).
--   No existing row is modified. Rollback = DROP TABLE.
--
-- CUTOVER decision deferred — run one of cutover_a.sql / cutover_b.sql
-- after Commander selects the strategy.

-- ── Step 1: New table ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_activity_inventory (
  user_id           uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  activity_id       integer     NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  item_hand_count   integer     NOT NULL DEFAULT 0 CHECK (item_hand_count >= 0),
  item_phallus_count integer    NOT NULL DEFAULT 0 CHECK (item_phallus_count >= 0),
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, activity_id)
);

-- ── Step 2: Indexes ──────────────────────────────────────────────────────────
-- The PK (user_id, activity_id) covers:
--   - exact (user, activity) lookup
--   - WHERE user_id = ?         (leftmost-prefix scan, no extra index needed)
--   - ORDER BY (user_id, activity_id)
--
-- Add ONE supplemental index for the admin "all users in activity X" pattern
-- (e.g. leaderboards, per-activity audit). Do NOT add a redundant index on
-- user_id alone — the PK already serves it.

CREATE INDEX IF NOT EXISTS idx_uai_activity
  ON public.user_activity_inventory (activity_id);

COMMENT ON TABLE public.user_activity_inventory IS
  'Per-(user, activity) item quantity. Item names come from activity.config.items — not stored here.';
COMMENT ON COLUMN public.user_activity_inventory.user_id IS
  'FK to users.id';
COMMENT ON COLUMN public.user_activity_inventory.activity_id IS
  'FK to activities.id. Enables activity-scoped item counts.';
COMMENT ON COLUMN public.user_activity_inventory.item_hand_count IS
  'propA quantity for this user in this activity. propA name comes from activity.config.items.propA.name.';
COMMENT ON COLUMN public.user_activity_inventory.item_phallus_count IS
  'propB quantity for this user in this activity. propB name comes from activity.config.items.propB.name.';
