/**
 * PostgreSQL-backed activities store — re-export shim.
 *
 * The legacy local-JSON `db.ts` (which wrote to `mock_db_activities.json`)
 * has been removed. This module now re-exports the RDS-backed
 * `lib/db/activitiesPg.ts` so that all callers import the SAME symbols
 * (`readDB`, `writeDB` removed, `listActivities`, `getActivityById`,
 * `createActivity`, `updateActivity`, `deleteActivity`,
 * `setActivityActive`) without further refactoring.
 *
 * BREAKING CHANGES from the old fs-backed module:
 *   - All exported functions are now ASYNC. Callers that used to
 *     `return NextResponse.json({ ok: true, data: listActivities() })`
 *     must `await` the call.
 *   - `readDB()` is kept (now async) for backward compat with the
 *     `/api/game/milestone/claim` and `/api/admin/activity/finalize`
 *     routes that need the active activity config.
 *   - `writeDB` has been REMOVED. There is no fs write path.
 */

export * from '@/lib/db/activitiesPg';

// Legacy synchronous-only callers (e.g. unit tests) historically used
// the fs-based `writeDB` to push JSON blobs. We no longer support that
// pattern. Calling `writeDB` throws to surface the missing functionality
// loudly rather than silently fall through to fs.writeFileSync.
export function writeDB(_data: unknown): never {
  throw new Error(
    '[db] writeDB() has been REMOVED. The mock_db JSON store is decommissioned. ' +
      'Use the RDS-backed functions in lib/db/activitiesPg.ts instead.'
  );
}