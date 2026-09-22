-- CUTOVER_B: Copy to activity 8 — current active activity
--
-- Copies existing global item_hand_count → user_activity_inventory(user, 8).item_hand_count
-- Copies existing global item_phallus_count → user_activity_inventory(user, 8).item_phallus_count
--
-- RATIONALE:
--   Activity 8 is the currently active (isGlobalEnabled=true) activity.
--   Most if not all of the existing players are likely active on activity 8.
--   Preserving their inventory gives them continuity.
--
-- PROS:
--   - Best continuity for currently active players
--   - Minimal disruption to the live player base
--
-- CONS:
--   - Some inventory may historically belong to activity 1, not activity 8
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
  8,  -- current active activity
  item_hand_count,
  item_phallus_count,
  NOW(),
  NOW()
FROM public.user_inventory
ON CONFLICT (user_id, activity_id) DO NOTHING;
