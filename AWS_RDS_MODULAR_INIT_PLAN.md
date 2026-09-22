# AWS RDS Modular Init Plan

## Purpose
This document is a read-only audit of the current SQL migration history under `supabase/migrations/` and proposes a safer multi-file initialization strategy for a vanilla AWS RDS PostgreSQL deployment.

This plan does **not** generate executable SQL yet. It traces the latest effective schema and function set, identifies Supabase-specific gaps, and proposes a modular file split for Commander approval.

---

## 1. Audit Scope

Audited migrations, in order:

- `supabase/migrations/0001_initial_schema.sql`
- `supabase/migrations/01_task_inventory_schema.sql`
- `supabase/migrations/02_battle_system_schema.sql`
- `supabase/migrations/03_admin_activity_schema.sql`
- `supabase/migrations/04_add_activities_config.sql`
- `supabase/migrations/05_banners_table.sql`
- `supabase/migrations/06_user_mgmt_schema.sql`
- `supabase/migrations/07_task_claim_lock_and_rpc.sql`
- `supabase/migrations/08_activity_cleanup_and_reset.sql`
- `supabase/migrations/09_milestone_claim_rpc.sql`
- `supabase/migrations/10_milestone_lock_column.sql`
- `supabase/migrations/11_webhook_atomic_rpc.sql`
- `supabase/migrations/12_add_personal_milestone_rpc.sql`
- `supabase/migrations/13_add_bulk_milestone_finalizer_rpc.sql`

Application call-site cross-checks were also used to determine which SQL functions are still live:

- `app/api/game/milestone/claim/route.ts`
- `app/api/admin/activity/finalize/route.ts`
- `app/api/webhook/user-action/route.ts`

---

## 2. Final State of Tables

This section describes the effective final schema after applying all migrations in order.

### 2.1 `public.users`

**Origin**
- Created in `0001_initial_schema.sql`
- Extended in `06_user_mgmt_schema.sql`

**Final columns**
- `id UUID PRIMARY KEY`
- `total_damage_dealt INT NOT NULL DEFAULT 0`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())`
- `email TEXT DEFAULT ''`
- `nickname TEXT DEFAULT ''`
- `avatar TEXT DEFAULT '👤'`

**Important notes**
- `id` currently references `auth.users(id)` in Supabase.
- `total_damage_dealt` coexists with `user_inventory.total_damage_dealt`; in current app logic, the battle/milestone flow reads cumulative damage from `user_inventory`, not this table.

---

### 2.2 `public.user_inventory`

**Origin**
- Created in `0001_initial_schema.sql` with legacy columns
- Re-declared in `02_battle_system_schema.sql` using `CREATE TABLE IF NOT EXISTS`
- Seeded/updated in `06_user_mgmt_schema.sql`

**Observed migration conflict**
- `0001` created legacy columns:
  - `item_hand`
  - `item_phallus`
  - `last_reset_date`
  - `task_consume_count`
  - `task_recharge_count`
- `02` attempted a new shape:
  - `item_hand_count`
  - `item_phallus_count`
  - `total_damage_dealt`
  - `created_at`
  - `updated_at`

Because `02` uses `CREATE TABLE IF NOT EXISTS`, it does **not** alter an already-existing table. Therefore, if `0001` was already applied, `02` alone does not migrate the old table into the new shape.

**However, current later migrations and application SQL clearly assume the newer schema.**

**Required final shape for AWS RDS**
The final vanilla PostgreSQL build should normalize `user_inventory` to the current effective application schema:

- `user_id UUID PRIMARY KEY`
- `item_hand_count INTEGER NOT NULL DEFAULT 0 CHECK (item_hand_count >= 0)`
- `item_phallus_count INTEGER NOT NULL DEFAULT 0 CHECK (item_phallus_count >= 0)`
- `total_damage_dealt BIGINT NOT NULL DEFAULT 0 CHECK (total_damage_dealt >= 0)`
- `created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())`
- `updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())`

**Do not carry forward the legacy columns** unless the Commander explicitly wants backward-compatibility shims.

---

### 2.3 `public.global_boss`

**Origin**
- Created in `0001_initial_schema.sql`
- Seeded again in `02_battle_system_schema.sql`

**Final columns**
- `id SERIAL PRIMARY KEY`
- `total_hp INT NOT NULL`
- `current_hp INT NOT NULL`
- `current_stage INT NOT NULL DEFAULT 1`

**Status**
- This appears to be a legacy compatibility table.
- The newer battle system uses `public.boss_status` as the single-source-of-truth.
- The migration comment in `02` explicitly says `boss_status` replaces legacy `global_boss`.

**Recommendation**
- Exclude `global_boss` from the clean RDS init unless legacy app code still depends on it.
- If a compatibility bridge is required, treat it as optional/deprecated.

---

### 2.4 `public.boss_status`

**Origin**
- Created in `02_battle_system_schema.sql`

**Final columns**
- `boss_id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid`
- `max_hp BIGINT NOT NULL DEFAULT 100000`
- `current_hp BIGINT NOT NULL DEFAULT 100000`
- `version INTEGER NOT NULL DEFAULT 1`
- `last_updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())`
- `created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())`

**Constraints**
- `CHECK (current_hp >= 0)`
- `CHECK (current_hp <= max_hp)`

**Seed behavior**
- A singleton row is inserted if absent.

---

### 2.5 `public.attack_logs`

**Origin**
- Created in `0001_initial_schema.sql`
- Re-declared in `02_battle_system_schema.sql` using `CREATE TABLE IF NOT EXISTS`

**Required final shape for AWS RDS**
Current code and later schema conventions align to the `02` version:

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `user_id UUID NOT NULL`
- `item_used VARCHAR(20) NOT NULL CHECK (item_used IN ('item_hand', 'item_phallus'))`
- `damage_dealt BIGINT NOT NULL DEFAULT 0 CHECK (damage_dealt >= 0)`
- `created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())`

**Notes**
- `0001` and `02` are close enough here that a clean rebuild should use the `02` definition directly.

---

### 2.6 `public.milestone_rewards`

**Origin**
- Created in `0001_initial_schema.sql` with a legacy shape
- Re-declared in `02_battle_system_schema.sql`
- Extended in `06_user_mgmt_schema.sql`
- Extended in `09_milestone_claim_rpc.sql`
- Reaffirmed in `10_milestone_lock_column.sql`

**Observed migration conflict**
- `0001` created a very different legacy schema with:
  - `id UUID PRIMARY KEY`
  - `milestone_threshold INT`
  - `reward_type` values `('battery', 'badge')`
  - `claimed_at NOT NULL`
- `02` expects a normalized per-user/per-milestone row shape:
  - composite primary key `(user_id, milestone_id)`
  - `is_claimed`
  - nullable `claimed_at`
- Later RPCs (`09`, `12`, `13`) clearly depend on the `02+` shape.

**Required final shape for AWS RDS**
Use the normalized latest schema only:

- `user_id UUID NOT NULL`
- `milestone_id INTEGER NOT NULL`
- `is_claimed BOOLEAN NOT NULL DEFAULT false`
- `claimed_at TIMESTAMPTZ`
- `created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())`
- `is_locked BOOLEAN NOT NULL DEFAULT false`
- `reward_type TEXT DEFAULT 'MEDAL' CHECK (reward_type IN ('ENERGY', 'MEDAL'))`
- `reward_value TEXT DEFAULT '挑战勋章'`
- `PRIMARY KEY (user_id, milestone_id)`

**Effective constraints/indexes**
- lock guard from `06`:
  - cannot have `is_locked = true AND is_claimed = true AND claimed_at IS NOT NULL`
- index for unlocked/unclaimed reads
- index for locked rows
- partial unique index from `09` on `(user_id, milestone_id) WHERE is_claimed = false`

**Important note**
- Because the table primary key is already `(user_id, milestone_id)`, the partial unique index is likely redundant for uniqueness and mainly acts as a filtered lookup index.

---

### 2.7 `public.user_daily_tasks`

**Origin**
- Created in `01_task_inventory_schema.sql`
- Altered in `07_task_claim_lock_and_rpc.sql`
- Assumed by `11_webhook_atomic_rpc.sql`

**Observed migration issue**
- `11_webhook_atomic_rpc.sql` updates `updated_at`, but `01` never created an `updated_at` column.
- Therefore the function in `11` implies a missing schema migration.

**Required final shape for AWS RDS**
To support the current RPC logic safely, the final schema should be:

- `user_id UUID NOT NULL`
- `date DATE NOT NULL DEFAULT CURRENT_DATE`
- `daily_energy_consumed INT NOT NULL DEFAULT 0`
- `daily_money_recharged NUMERIC(12, 2) NOT NULL DEFAULT 0`
- `recharge_processed BOOLEAN NOT NULL DEFAULT false`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())`
- `PRIMARY KEY (user_id, date)`

**Conclusion**
- `created_at` and `updated_at` should be added explicitly in the modular AWS SQL even though they are not fully represented in the current migration chain.

---

### 2.8 `public.webhook_idempotency`

**Origin**
- Created in `01_task_inventory_schema.sql`

**Final columns**
- `tx_id TEXT PRIMARY KEY`
- `processed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())`

---

### 2.9 `public.task_progress`

**Origin**
- Created in `02_battle_system_schema.sql`

**Final columns**
- `user_id UUID NOT NULL`
- `task_type VARCHAR(50) NOT NULL CHECK (task_type IN ('daily_energy', 'daily_recharge'))`
- `reset_date DATE NOT NULL DEFAULT CURRENT_DATE`
- `current_progress INTEGER NOT NULL DEFAULT 0`
- `is_claimed BOOLEAN NOT NULL DEFAULT false`
- `created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())`
- `updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())`
- `PRIMARY KEY (user_id, task_type, reset_date)`

---

### 2.10 `public.attack_idempotency`

**Origin**
- Created in `02_battle_system_schema.sql`

**Final columns**
- `idempotency_key TEXT PRIMARY KEY`
- `processed_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())`

---

### 2.11 `public.activities`

**Origin**
- Created in `03_admin_activity_schema.sql`
- Extended in `04_add_activities_config.sql`
- Seeded with system row in `05_banners_table.sql`

**Final columns**
- `id SERIAL PRIMARY KEY`
- `name VARCHAR(50) NOT NULL`
- `type VARCHAR(10) NOT NULL CHECK (type IN ('LIVE2D', 'ENERGY'))`
- `start_time TIMESTAMPTZ NOT NULL`
- `end_time TIMESTAMPTZ NOT NULL`
- `status VARCHAR(10) NOT NULL DEFAULT 'DISABLED' CHECK (status IN ('ENABLED', 'DISABLED'))`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `config JSONB DEFAULT '{"isGlobalEnabled": false}'::jsonb`

**Constraints/indexes**
- `CHECK (end_time > start_time)`
- unique partial index on `(name, start_time, end_time)` where `status = 'ENABLED'`
- config expression index on `(config->>'isGlobalEnabled')`

**Special data**
- system row inserted by `05`:
  - `id = 999999`
  - `name = '__banner_global__'`

**Recommendation**
- Decide whether this banner-global row belongs in seed data or whether banner global config should live in a dedicated table in the future.
- For strict Commander parity, keep it as seed data in the first RDS cut.

---

### 2.12 `public.banners`

**Origin**
- Created in `05_banners_table.sql`

**Final columns**
- `id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT`
- `image_url TEXT NOT NULL DEFAULT ''`
- `redirect_id TEXT NOT NULL DEFAULT ''`
- `redirect_type TEXT NOT NULL DEFAULT 'none' CHECK (redirect_type IN ('activity', 'external', 'none'))`
- `is_active BOOLEAN NOT NULL DEFAULT false`
- `show_countdown BOOLEAN NOT NULL DEFAULT false`
- `sort_order INTEGER NOT NULL DEFAULT 0`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

---

### 2.13 `public.admin_audit_log`

**Origin**
- Created in `06_user_mgmt_schema.sql`

**Final columns**
- `id BIGSERIAL PRIMARY KEY`
- `route TEXT NOT NULL`
- `action TEXT NOT NULL`
- `operator_id TEXT NOT NULL`
- `target_user_id TEXT NOT NULL`
- `field_name TEXT`
- `old_value TEXT`
- `new_value TEXT`
- `ip_address TEXT`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

---

## 3. Final Function Set (Latest Effective Versions)

This section lists the functions that should be treated as the current canonical versions.

### 3.1 Keep: `public.increment_boss_version(UUID)`
From `02_battle_system_schema.sql`

Purpose:
- Atomic version bump for `boss_status`

---

### 3.2 Keep: `public.add_user_damage(UUID, BIGINT)`
From `02_battle_system_schema.sql`

Purpose:
- Atomically upsert/increment `user_inventory.total_damage_dealt`

---

### 3.3 Keep: `public.increment_item_count(UUID, TEXT, INTEGER)`
From `02_battle_system_schema.sql`

Purpose:
- Atomically increment item counters in `user_inventory`

---

### 3.4 Keep: `public.increment_task_progress(UUID, TEXT, DATE, INT)`
From `07_task_claim_lock_and_rpc.sql`

Purpose:
- Atomic upsert + increment on `task_progress`

---

### 3.5 Keep, but review scheduler strategy: `public.clear_expired_items()`
From `08_activity_cleanup_and_reset.sql`

Purpose:
- Clears item counts after active activity end

Vanilla Postgres note:
- Function logic is portable
- The **`pg_cron` scheduling part is not portable by default to AWS RDS** and must be handled separately

---

### 3.6 Keep, but review scheduler strategy: `public.reset_daily_tasks()`
From `08_activity_cleanup_and_reset.sql`

Purpose:
- Marks previous task rows as claimed after reset window

Vanilla Postgres note:
- Function logic is portable
- Current scheduling depends on `cron.schedule(...)`

---

### 3.7 Historical only, do not carry forward as canonical: `public.claim_milestone_reward(...)`
From `09_milestone_claim_rpc.sql`

Why not canonical:
- Application code no longer calls it
- Its semantics are superseded by the newer personal-damage-based claim function

---

### 3.8 Keep: `public.increment_user_daily_task(UUID, DATE, TEXT, INT, BOOLEAN)`
From `11_webhook_atomic_rpc.sql`

Purpose:
- Atomic upsert/increment on `user_daily_tasks`

Important note:
- Requires `user_daily_tasks.updated_at`, which is missing from the current migration chain and must be added in the final modular SQL

---

### 3.9 Keep as canonical milestone claim RPC: `public.claim_personal_milestone_reward(UUID, INTEGER, BIGINT, TEXT, TEXT, TIMESTAMPTZ)`
From `12_add_personal_milestone_rpc.sql`

This is the latest effective milestone claim function.

Why canonical:
- Current application route `app/api/game/milestone/claim/route.ts` calls this function
- It validates personal cumulative damage against `user_inventory.total_damage_dealt`
- It blocks locked/already-claimed states
- It grants rewards atomically

---

### 3.10 Keep as canonical admin finalizer RPC: `public.finalize_activity_milestone_rewards(BIGINT, JSONB, BOOLEAN, TIMESTAMPTZ)`
From `13_add_bulk_milestone_finalizer_rpc.sql`

This is the latest effective admin bulk settlement function.

Why canonical:
- Current application route `app/api/admin/activity/finalize/route.ts` calls this function
- Supports dry-run and finalization
- Performs set-based user eligibility selection inside SQL
- Is idempotent by design

---

### 3.11 Helper trigger function: `update_updated_at_column()`
From `02_battle_system_schema.sql`

Purpose:
- Shared `updated_at` trigger helper

Keep if the final schema continues using trigger-based timestamp maintenance.

---

## 4. Vanilla Postgres Gap Analysis

This is the critical AWS RDS section.

### 4.1 Supabase Auth dependency: `auth.users`

Current state:
- `public.users.id` references `auth.users(id)` in `0001_initial_schema.sql`

Problem on AWS RDS:
- Raw PostgreSQL on RDS does not provide the Supabase `auth` schema or `auth.users` table.

Required decision:
- The application must own its own canonical `public.users` identity records.
- The foreign key to `auth.users(id)` cannot be used on RDS.

Recommended AWS RDS approach:
- Make `public.users.id` a standalone primary key with no external `auth.users` reference
- Treat `public.users` as the application user table
- If auth is handled elsewhere (e.g. Cognito, custom auth service, game platform ID), map the external subject ID into `public.users.id`

Recommended follow-up decision for Commander:
- Confirm whether `users.id` should remain UUID
- If yes, decide who generates it:
  - application server
  - Cognito subject mapping
  - database default via `gen_random_uuid()`

---

### 4.2 Supabase Auth helper dependency: `auth.uid()`

Current state:
- RLS policies in `0001_initial_schema.sql` use `auth.uid()`

Problem on AWS RDS:
- `auth.uid()` is Supabase-specific and unavailable in vanilla PostgreSQL

Impact:
- Those policies cannot be reused as-is

Recommended AWS RDS approach:
- Remove Supabase-style RLS policies from the first RDS bootstrap
- Enforce access control at the application/API layer initially
- Reintroduce database RLS later only if you also introduce a compatible auth context propagation strategy

---

### 4.3 Supabase role model: `service_role`, `authenticated`

Current state:
- Many migrations create policies/grants specifically to `service_role` and `authenticated`

Problem on AWS RDS:
- These roles do not exist by default on vanilla PostgreSQL

Recommended AWS RDS approach:
- Do not port Supabase role grants/policies literally
- Replace them with one of the following:
  - minimal application DB role strategy
  - owner/executor roles defined explicitly for RDS
  - or skip role-granular SQL permissions in phase 1 and keep the DB private behind the API

---

### 4.4 Supabase scheduler dependency: `cron.schedule(...)`

Current state:
- `08_activity_cleanup_and_reset.sql` schedules jobs using `cron.schedule`

Problem on AWS RDS:
- This assumes `pg_cron`
- Availability/configuration on AWS RDS depends on engine/version/parameter-group support and operational decisions

Recommended AWS RDS approach:
- Do **not** embed scheduler assumptions in `aws_03_functions.sql`
- Separate scheduler strategy from base schema
- Preferred options:
  - application-level scheduled jobs
  - AWS EventBridge + Lambda / ECS task / cron worker
  - RDS `pg_cron` only if explicitly approved and provisioned

---

### 4.5 Supabase storage dependency

Current SQL audit result:
- No SQL migration directly depends on Supabase Storage tables/functions

Operational note:
- The application stores uploaded assets under `/public/uploads` at the app layer, not in SQL migrations
- For AWS deployment, asset strategy is still a concern, but it is **not** a blocker in the SQL plan itself

---

### 4.6 `gen_random_uuid()` / extension dependency

Current state:
- Multiple tables use `gen_random_uuid()`

Problem on AWS RDS:
- Requires `pgcrypto` extension

Recommended AWS RDS approach:
- Explicitly enable `pgcrypto` in the schema bootstrap if allowed on the target RDS instance
- If extension policy is restrictive, move UUID generation to the application layer instead

---

### 4.7 Timezone and timestamp conventions

Current state:
- Migrations use both:
  - `timezone('utc'::text, now())`
  - `NOW()`
  - `AT TIME ZONE 'Asia/Shanghai'`

Recommendation:
- Standardize on `TIMESTAMPTZ` + UTC defaults in schema
- Keep business-time comparisons explicit in function logic where needed
- Avoid mixed implicit timezone assumptions in the final RDS SQL

---

## 5. Audit Findings: Migration Risks and Silent-Failure Zones

These are the main reasons Commander rejected a giant single SQL blob.

### 5.1 `user_inventory` is internally inconsistent across migrations
- `0001` creates legacy columns
- `02` assumes a new schema but uses `CREATE TABLE IF NOT EXISTS`
- Later functions assume the new schema definitely exists

This is the clearest example of why a clean rebuild must use a **single canonical final definition**, not replay the current historical conflicts blindly.

### 5.2 `milestone_rewards` also has a legacy/new-schema collision
- `0001` uses a UUID row-per-claim design
- `02+` use a normalized `(user_id, milestone_id)` model
- Later RPCs assume the normalized model exclusively

### 5.3 `user_daily_tasks` RPC expects columns not fully created by migrations
- `11_webhook_atomic_rpc.sql` updates `updated_at`
- no earlier migration clearly adds `updated_at` to `user_daily_tasks`

### 5.4 `global_boss` and `boss_status` overlap
- `global_boss` is legacy
- `boss_status` is the intended replacement
- Replaying both without intent would preserve unnecessary baggage

### 5.5 Banner global config is stored as a pseudo-system activity row
- Functional, but architecturally mixed-purpose
- Acceptable for first parity cut, but should be called out as a design compromise

---

## 6. Proposed Modular Structure

Commander asked for a clean 3-to-4 file structure instead of one massive SQL file.

Recommended split:

### `aws_01_schema.sql`
Scope:
- extensions required for vanilla PostgreSQL compatibility
- all tables in their **final canonical form only**
- constraints
- foreign keys
- trigger helper function `update_updated_at_column()`
- triggers for `updated_at`

Include:
- `users`
- `user_inventory`
- `boss_status`
- `attack_logs`
- `user_daily_tasks`
- `webhook_idempotency`
- `task_progress`
- `milestone_rewards`
- `attack_idempotency`
- `activities`
- `banners`
- `admin_audit_log`

Exclude from base schema unless explicitly needed:
- legacy `global_boss`

---

### `aws_02_indexes.sql`
Scope:
- all non-primary-key indexes
- partial indexes
- expression indexes

Why separate:
- easier to retry safely
- easier to profile/trim if RDS performance or planner behavior needs tuning

Expected contents:
- user damage leaderboard indexes
- task lookup indexes
- milestone lookup/locked/unclaimed indexes
- attack log indexes
- banner sorting/filter indexes
- activities config / active-window indexes
- admin audit indexes

---

### `aws_03_functions.sql`
Scope:
- all canonical PL/pgSQL functions only
- grants only if Commander wants explicit DB roles
- no scheduler binding

Include canonical functions:
- `update_updated_at_column()`
- `increment_boss_version()`
- `add_user_damage()`
- `increment_item_count()`
- `increment_task_progress()`
- `increment_user_daily_task()`
- `clear_expired_items()`
- `reset_daily_tasks()`
- `claim_personal_milestone_reward()`
- `finalize_activity_milestone_rewards()`

Exclude:
- obsolete `claim_milestone_reward()`

---

### `aws_04_seed.sql`
Scope:
- strictly optional seed/reference data
- environment-sensitive rows only

Suggested contents:
- singleton `boss_status` seed row
- `activities` system row `id=999999` for banner global config, if Commander wants parity with current app behavior
- optional dev/demo users and inventory rows, but only if explicitly approved

Recommendation:
- Split production-safe seeds from demo seeds with clear comment blocks
- Demo user inserts from `06_user_mgmt_schema.sql` should **not** be silently included in production bootstrap

---

## 7. Recommended Canonical Table Set for RDS v1

If the goal is a clean, production-oriented AWS RDS bootstrap, the canonical table set should be:

- `public.users`
- `public.user_inventory`
- `public.boss_status`
- `public.attack_logs`
- `public.user_daily_tasks`
- `public.webhook_idempotency`
- `public.task_progress`
- `public.milestone_rewards`
- `public.attack_idempotency`
- `public.activities`
- `public.banners`
- `public.admin_audit_log`

Legacy/optional:
- `public.global_boss`

---

## 8. Commander Decisions Needed Before SQL Generation

Before generating the modular AWS SQL files, the following decisions should be confirmed:

1. **Identity source**
   - Should `public.users.id` remain UUID?
   - What external auth/user source will own that identifier on AWS RDS?

2. **Legacy compatibility**
   - Should `global_boss` be kept as a compatibility table, or removed entirely?

3. **Banner global config strategy**
   - Keep the `activities.id = 999999` pseudo-system row for parity?
   - Or redesign into a dedicated config table in a later phase?

4. **Scheduler strategy**
   - Use app-level cron / EventBridge / worker job?
   - Or explicitly provision `pg_cron` on RDS?

5. **Seed policy**
   - Should demo users from `06_user_mgmt_schema.sql` be excluded from production completely?

6. **DB role strategy**
   - Should the first AWS SQL output omit most grants/policies and rely on private-network API access?
   - Or should we define explicit RDS roles in the modular SQL?

---

## 9. Bottom Line

The current migration history contains multiple historical collisions and implicit assumptions that are safe enough in an iterative Supabase workflow but too risky for a single-shot AWS RDS initialization.

The safest path is:

- **do not replay history literally**
- **derive one canonical final schema**
- **exclude Supabase-only auth/RLS constructs**
- **separate schema, indexes, functions, and seed data into modular files**
- **treat `claim_personal_milestone_reward` and `finalize_activity_milestone_rewards` as the authoritative milestone RPCs**

Once Commander approves this plan, the next step is to generate:

- `aws_01_schema.sql`
- `aws_02_indexes.sql`
- `aws_03_functions.sql`
- `aws_04_seed.sql`
