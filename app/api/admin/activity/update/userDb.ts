/**
 * PostgreSQL-backed admin user store — re-export shim.
 *
 * The Supabase-based implementation has been removed. The new
 * implementation lives at `lib/db/userPg.ts` and writes to AWS RDS.
 *
 * All public functions from the old Supabase version are preserved
 * as async signatures; callers that imported `updateUserInventory`,
 * `listUsers`, `getUserById`, `getComputedTotalDamage`,
 * `getUserMilestones` continue to work after their imports are
 * updated from `@/app/api/admin/activity/update/userDb` to this
 * module — and from synchronous to `await` calls.
 */

export * from '@/lib/db/userPg';