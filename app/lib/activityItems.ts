/**
 * REPARK 7.0 (2026-09-18) — admin-only activity-items guard.
 *
 * Pure predicate: does a given activity's `config.items` block declare at
 * least one usable prop (propA.rows or propB.rows is a non-empty array)?
 *
 * Used by:
 *   - /api/admin/users/search                  → surface `hasItems` per activity
 *   - /admin/users (page.tsx)                  → conditionally render 道具数量管理
 *   - /api/admin/users/[uid]/inventory/adjust  → defence-in-depth POST guard
 *
 * NOT used by any H5 battle route in this round. The H5 surface only ever
 * sees the single global-active activity, which today is also the only one
 * that has items — so the cross-activity drift cannot reach the H5 chain.
 *
 * MUST stay a pure function: no DB / getActiveActivity() / logging / side
 * effects. The admin panel tracks the operator's per-activity selection;
 * `hasItems` is decided strictly from that selection's own config.
 */
export function hasActivityItems(
  cfg: Record<string, unknown> | null | undefined,
): boolean {
  if (!cfg || typeof cfg !== 'object') return false;
  const items = cfg.items as Record<string, unknown> | undefined;
  if (!items || typeof items !== 'object') return false;

  const propA = items.propA as Record<string, unknown> | undefined;
  const propB = items.propB as Record<string, unknown> | undefined;

  const rowsA = propA?.rows;
  const rowsB = propB?.rows;

  const aOk = Array.isArray(rowsA) && rowsA.length > 0;
  const bOk = Array.isArray(rowsB) && rowsB.length > 0;
  return aOk || bOk;
}
