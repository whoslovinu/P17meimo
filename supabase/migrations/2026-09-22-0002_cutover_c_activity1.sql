-- CUTOVER_C: Copy to activity 1 — original activity
--
-- Copies existing global item_hand_count → user_activity_inventory(user, 1).item_hand_count
-- Copies existing global item_phallus_count → user_activity_inventory(user, 1).item_phallus_count
--
-- RATIONALE:
--   Activity 1 was the first activity that had items configured.
--   All historical users with item inventory likely participated in activity 1.
--   This attribution is also an assumption (same uncertainty as B).
--
-- PROS:
--   - Preserves historical inventory for the original activity
--
-- CONS:
--   - Players currently active on activity 8 lose their current inventory
--   - Attribution is an assumption, not a fact
--
-- Run this AFTER the base migration (2026-09-22-0001_activity_scoped_inventory.sql)
-- Verify affected users first:
--   SELECT COUNT(*) AS users, SUM(item_hand_count) AS total_propA, SUM(item_phallus_count) AS total_propB
--   FROM public.user_inventory
--   WHERE item_hand_count > 0 OR item_phallus_count > 0;

INSERT INTO public.user_activity_inventory
  (user_id, activity_id, item_hand_count, item_phallus_count, created_at, updated_at)
SELECT
  user_id,
  1,  -- original activity
  item_hand_count,
  item_phallus_count,
  NOW(),
  NOW()
FROM public.user_inventory
ON CONFLICT (user_id, activity_id) DO NOTHING;
