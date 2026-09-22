# MILESTONE_AUTO_CLAIM_IMPLEMENTATION_PLAN

## Document Purpose

This document defines the **read-only architectural implementation plan** for fixing milestone reward logic and adding an **admin-triggered batch auto-distribution engine**.

This plan is based on the current repository audit and is intended for Commander review **before any code modification begins**.

---

## Executive Summary

The current milestone claim system is using the **wrong business model**.

### Current incorrect model
The existing route `app/api/game/milestone/claim/route.ts` checks whether a milestone is claimable by reading **global BOSS HP thresholds**.

### Correct required model
Per requirements, milestone rewards must be unlocked by **personal cumulative damage**, i.e.:

- user can claim milestone Y when
- `user_inventory.total_damage_dealt >= milestone.threshold`

Therefore, the implementation must happen in **two phases**:

1. **Phase 1 — Logic Correction**
   Rewrite the H5 claim API so it validates against `user_inventory.total_damage_dealt`, not global BOSS HP.

2. **Phase 2 — Auto-Distribution Engine**
   Add an **Admin API Trigger (Batch Processor)** to distribute all unclaimed eligible milestone rewards after activity end.

This plan explicitly avoids:
- Vercel Cron
- app-level for-loops over thousands of users
- Redis-based user scans for reward settlement

This plan follows **Next.js 15 + Supabase/PostgreSQL best practices**:
- server-only privileged writes through admin route / service-role path
- reward settlement performed in PostgreSQL transactionally
- bulk processing done inside SQL / RPC rather than in JavaScript loops

---

# Phase 1: Logic Correction (The API Fix)

## 1.1 Problem Statement

Current route:
- `app/api/game/milestone/claim/route.ts`

Current defect:
- it calls `getActivityState()`
- reads `currentHp` + `maxHp`
- uses `isThresholdMet(currentHp, maxHp, milestoneId)`
- therefore claimability is tied to **global boss phase**

This is incompatible with the required **personal cumulative damage** milestone model.

---

## 1.2 Correct milestone source of truth

The frontend initialization payload already exposes milestones from the active activity config.

Current shape from `app/api/game/init/route.ts`:

- `milestones[].id`
- `milestones[].threshold`
- `milestones[].rewardType`
- `milestones[].energyValue`
- `milestones[].medalId`

### Required interpretation
Each milestone row must be interpreted as:

- `id`: stable milestone identifier
- `threshold`: **personal total damage threshold**
- `rewardType`: `ENERGY | MEDAL`
- reward payload: `energyValue` or `medalId`

### Important design correction
The API must stop inferring milestone eligibility from:
- boss HP
- stage percentage
- milestone id such as `75 / 50 / 25`

Instead it must:
1. load active activity config
2. locate the requested milestone in `config.milestones`
3. read current user cumulative damage from `user_inventory.total_damage_dealt`
4. compare:
   - `total_damage_dealt >= milestone.threshold`

---

## 1.3 Recommended route rewrite strategy

### Target file
- `app/api/game/milestone/claim/route.ts`

### Replace these concepts

#### Remove / stop relying on
- `getActivityState()` for claimability
- `isThresholdMet(currentHp, maxHp, milestoneId)`
- hardcoded milestone logic like `75 / 50 / 25 -> hp threshold`

#### Replace with
A new helper concept:

```ts
async function getUserDamage(userId: string): Promise<number>
```

Production source:
- `public.user_inventory.total_damage_dealt`

Development source:
- `mockUserDb.findUser(userId)?.totalDamage`

And a new milestone resolver:

```ts
function getMilestoneDefinition(activityConfig, milestoneId)
```

This should search `config.milestones` directly by `id`.

---

## 1.4 Proposed request validation model

### Current issue
Current route hardcodes:
- `MILESTONE_IDS = [75, 50, 25]`

This is too rigid and tightly coupled to the old global-HP model.

### Proposed model
Route validation should instead:
- accept any positive milestone id
- verify that this id exists in the currently active activity config

### Why
This keeps the route aligned with the admin-configurable milestone system.

Recommended behavior:
- if requested milestone id does not exist in active config:
  - return `404 MILESTONE_NOT_FOUND`

---

## 1.5 Proposed claim flow (corrected)

### H5 claim flow
1. Parse request body
2. Resolve authenticated `userId`
3. Load active activity config
4. Block if activity has ended for manual claim path
5. Resolve milestone definition from `config.milestones`
6. Load user cumulative damage
7. Verify:
   - `userDamage >= milestone.threshold`
8. Check whether milestone already claimed
9. Atomically grant reward + mark claimed
10. Return standardized response

### Pseudocode

```ts
const milestone = active.config.milestones.find((m) => m.id === milestoneId)
if (!milestone) return 404

const userDamage = await getUserTotalDamage(userId)
if (userDamage < milestone.threshold) {
  return 400 THRESHOLD_NOT_MET
}

// atomic claim via RPC
await supabase.rpc('claim_personal_milestone_reward', {
  p_user_id: userId,
  p_milestone_id: milestone.id,
  p_threshold: milestone.threshold,
  p_reward_type: milestone.rewardType,
  p_reward_value: ...
})
```

---

## 1.6 Database-side eligibility rule

The route must never trust the frontend.

Even if the frontend already knows milestone thresholds from `game/init`, the server must independently verify:

```sql
SELECT total_damage_dealt
FROM public.user_inventory
WHERE user_id = $1;
```

Eligibility condition:

```sql
total_damage_dealt >= milestone.threshold
```

---

## 1.7 Claimed-state persistence

### Keep using
`public.milestone_rewards`

Recommended canonical row model:
- `user_id`
- `milestone_id`
- `is_claimed`
- `claimed_at`
- `reward_type`
- `reward_value`
- `is_locked`

### Important policy
A milestone should be considered claimed if:
- row exists and `is_claimed = true`

### Important anti-corruption rule
If a reward grant and claim marking are coupled, they **must** happen in the same SQL transaction.

The current JS fallback path that only upserts `milestone_rewards` without reliably granting reward should be retired in favor of a **single DB RPC path**.

---

## 1.8 Recommended RPC for manual claim

Instead of reusing the old HP-based claim assumptions, introduce a new RPC dedicated to **personal damage milestone claims**.

Suggested name:

```sql
public.claim_personal_milestone_reward(...)
```

Suggested responsibilities:
1. lock/validate target milestone row logically
2. read `user_inventory.total_damage_dealt`
3. reject if below threshold
4. reject if already claimed
5. insert/update `milestone_rewards`
6. grant `ENERGY` or `MEDAL`
7. commit atomically

### Why RPC is preferred
- keeps race handling in PostgreSQL
- removes split-brain between JS fallback and SQL truth
- easier to reuse from both H5 claim API and admin batch finalizer

---

# Phase 2: The Auto-Distribution Engine (Admin API Trigger)

## 2.1 Why not Vercel Cron

Commander directive: do not use Vercel Cron because activity end times are dynamic.

This is correct.

Reasons:
- activity end time is data-driven, not fixed deployment-time schedule
- multiple activities may exist
- manual operational control is useful for irreversible reward settlement
- finalization should be idempotent and explicitly observable

---

## 2.2 Recommended architecture

### New endpoint
Create an **admin-only batch finalization endpoint**:

- `app/api/admin/activity/finalize/route.ts`

### Trigger semantics
This endpoint is manually triggered by admin after activity end.

### Responsibility
Given an activity id:
1. load activity config
2. verify activity already ended
3. for each configured milestone threshold
4. bulk grant all eligible but unclaimed rewards
5. return summary counts per milestone

### Why admin-triggered batch processor is the right fit
- works with dynamic end times
- avoids always-on scheduler complexity
- auditable and repeatable
- can be safely retried if written idempotently

---

## 2.3 Endpoint design

### Request body
Suggested payload:

```json
{
  "activityId": "<id>",
  "dryRun": false
}
```

### Required auth
Must use strong existing admin guard:
- `requireAdminAuth(req)`
- server-only route
- no public exposure

### Response payload
Suggested response:

```json
{
  "ok": true,
  "data": {
    "activityId": "...",
    "finalizedAt": "2026-06-08T...Z",
    "milestones": [
      {
        "milestoneId": 101,
        "threshold": 10,
        "rewardType": "ENERGY",
        "eligibleUsers": 823,
        "newlyClaimed": 823
      },
      {
        "milestoneId": 102,
        "threshold": 50,
        "rewardType": "MEDAL",
        "eligibleUsers": 117,
        "newlyClaimed": 117
      }
    ]
  }
}
```

---

## 2.4 Core SQL strategy

## Goal
Find all users where:

- `user_inventory.total_damage_dealt >= milestone.threshold`
- `milestone_rewards` for that `(user_id, milestone_id)` is either:
  - missing
  - or `is_claimed = false`
- and not manually locked

### Critical requirement
Do this in SQL, not in Node.js loops.

---

## 2.5 Recommended database design: one bulk RPC per activity finalization

Suggested RPC name:

```sql
public.finalize_activity_milestone_rewards(
  p_activity_id UUID,
  p_finalized_at TIMESTAMPTZ DEFAULT now()
)
```

### Recommended internal data flow
Because milestone config currently lives in app-layer activity config, there are two implementation options.

---

## 2.6 Preferred option: pass milestone payload into SQL RPC

Because current milestone config is not normalized into its own SQL table, the cleanest migration-safe approach is:

### Admin route loads active activity config in app layer
Then calls SQL RPC once per milestone, or preferably one RPC with a JSON payload.

Suggested RPC signature:

```sql
public.finalize_activity_milestone_rewards(
  p_activity_id UUID,
  p_milestones JSONB,
  p_finalized_at TIMESTAMPTZ DEFAULT now()
)
```

Where `p_milestones` is:

```json
[
  {
    "id": 101,
    "threshold": 10,
    "rewardType": "ENERGY",
    "rewardValue": "500"
  },
  {
    "id": 102,
    "threshold": 50,
    "rewardType": "MEDAL",
    "rewardValue": "10021"
  }
]
```

This keeps:
- source-of-truth still in active activity config
- batch settlement inside SQL
- no per-user JS iteration

---

## 2.7 Exact SQL pattern for eligible-but-unclaimed selection

For a single milestone, the core eligibility SQL should look like this:

```sql
WITH eligible AS (
  SELECT ui.user_id
  FROM public.user_inventory ui
  LEFT JOIN public.milestone_rewards mr
    ON mr.user_id = ui.user_id
   AND mr.milestone_id = $1
  WHERE ui.total_damage_dealt >= $2
    AND (
      mr.user_id IS NULL
      OR mr.is_claimed = FALSE
    )
    AND COALESCE(mr.is_locked, FALSE) = FALSE
)
SELECT * FROM eligible;
```

Where:
- `$1 = milestone_id`
- `$2 = threshold`

This is efficient because:
- `user_inventory.total_damage_dealt` already has an index
- `milestone_rewards` has primary key `(user_id, milestone_id)`
- unclaimed rows also have supporting index patterns

---

## 2.8 Bulk transactional settlement SQL

For one milestone, the settlement pattern should be:

1. collect eligible users
2. upsert `milestone_rewards`
3. grant rewards in set-based SQL
4. commit transaction

### Example transactional shape

```sql
WITH eligible AS (
  SELECT ui.user_id
  FROM public.user_inventory ui
  LEFT JOIN public.milestone_rewards mr
    ON mr.user_id = ui.user_id
   AND mr.milestone_id = p_milestone_id
  WHERE ui.total_damage_dealt >= p_threshold
    AND (mr.user_id IS NULL OR mr.is_claimed = FALSE)
    AND COALESCE(mr.is_locked, FALSE) = FALSE
), claimed AS (
  INSERT INTO public.milestone_rewards (
    user_id,
    milestone_id,
    is_claimed,
    claimed_at,
    reward_type,
    reward_value
  )
  SELECT
    e.user_id,
    p_milestone_id,
    TRUE,
    p_finalized_at,
    p_reward_type,
    p_reward_value
  FROM eligible e
  ON CONFLICT (user_id, milestone_id)
  DO UPDATE SET
    is_claimed = TRUE,
    claimed_at = EXCLUDED.claimed_at,
    reward_type = EXCLUDED.reward_type,
    reward_value = EXCLUDED.reward_value
  WHERE public.milestone_rewards.is_claimed = FALSE
    AND COALESCE(public.milestone_rewards.is_locked, FALSE) = FALSE
  RETURNING user_id
)
SELECT count(*) FROM claimed;
```

This gives a set of users newly finalized for that milestone.

---

## 2.9 Bulk reward grant strategy

## ENERGY rewards
If the milestone reward is `ENERGY`, grant the energy reward in set-based SQL.

Assuming current system continues to represent energy reward via `item_hand_count` or a dedicated currency field, the update should be bulk:

```sql
UPDATE public.user_inventory ui
SET item_hand_count = ui.item_hand_count + p_energy_amount,
    updated_at = timezone('utc'::text, now())
FROM claimed c
WHERE ui.user_id = c.user_id;
```

> Note: if `ENERGY` is conceptually not the same as item inventory, this is the right time to normalize reward destination. If the product means “battery/currency”, a dedicated balance column or wallet table would be cleaner.

## MEDAL rewards
For medals, do not fake it in application memory.

Recommended approach:
- insert into a dedicated `user_medals` / `user_badges` table
- or call an existing badge-grant RPC if the platform already has one

Set-based example:

```sql
INSERT INTO public.user_badges (user_id, badge_id, granted_at)
SELECT c.user_id, p_badge_id, p_finalized_at
FROM claimed c
ON CONFLICT (user_id, badge_id) DO NOTHING;
```

This ensures medal grant is also idempotent.

---

## 2.10 Full RPC design recommendation

### Preferred structure
Create one SQL function that loops **over milestones inside PostgreSQL**, not over users in Node.js.

Pseudo-flow inside RPC:
1. parse `p_milestones JSONB`
2. for each milestone object in JSONB array
   - run one set-based eligible selection
   - upsert claim rows
   - bulk grant reward
   - record summary counts
3. return JSON summary

### Why this is acceptable
This is not the forbidden “app-level for-loop over thousands of users”.
This is a **small SQL-side loop over milestone definitions** only.

A typical activity has very few milestones.
Looping over 3–20 milestones in PL/pgSQL is perfectly acceptable.

---

## 2.11 Example RPC outline

```sql
CREATE OR REPLACE FUNCTION public.finalize_activity_milestone_rewards(
  p_activity_id UUID,
  p_milestones JSONB,
  p_finalized_at TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  m JSONB;
  v_milestone_id INTEGER;
  v_threshold BIGINT;
  v_reward_type TEXT;
  v_reward_value TEXT;
  v_claimed_count INTEGER;
  v_result JSONB := '[]'::jsonb;
BEGIN
  FOR m IN SELECT * FROM jsonb_array_elements(p_milestones)
  LOOP
    v_milestone_id := (m->>'id')::INTEGER;
    v_threshold := (m->>'threshold')::BIGINT;
    v_reward_type := m->>'rewardType';
    v_reward_value := m->>'rewardValue';

    WITH eligible AS (
      SELECT ui.user_id
      FROM public.user_inventory ui
      LEFT JOIN public.milestone_rewards mr
        ON mr.user_id = ui.user_id
       AND mr.milestone_id = v_milestone_id
      WHERE ui.total_damage_dealt >= v_threshold
        AND (mr.user_id IS NULL OR mr.is_claimed = FALSE)
        AND COALESCE(mr.is_locked, FALSE) = FALSE
    ), claimed AS (
      INSERT INTO public.milestone_rewards (
        user_id, milestone_id, is_claimed, claimed_at, reward_type, reward_value
      )
      SELECT user_id, v_milestone_id, TRUE, p_finalized_at, v_reward_type, v_reward_value
      FROM eligible
      ON CONFLICT (user_id, milestone_id)
      DO UPDATE SET
        is_claimed = TRUE,
        claimed_at = EXCLUDED.claimed_at,
        reward_type = EXCLUDED.reward_type,
        reward_value = EXCLUDED.reward_value
      WHERE public.milestone_rewards.is_claimed = FALSE
        AND COALESCE(public.milestone_rewards.is_locked, FALSE) = FALSE
      RETURNING user_id
    )
    SELECT count(*) INTO v_claimed_count FROM claimed;

    -- reward grant branch here
    -- ENERGY => bulk update inventory/balance
    -- MEDAL  => bulk insert user_badges

    v_result := v_result || jsonb_build_object(
      'milestoneId', v_milestone_id,
      'threshold', v_threshold,
      'rewardType', v_reward_type,
      'newlyClaimed', v_claimed_count
    );
  END LOOP;

  RETURN v_result;
END;
$$;
```

---

## 2.12 Transactional guarantees

### Required guarantee
For each milestone batch, the following must happen atomically:
- claim mark written
- reward granted

### Best practice
Do both inside the same SQL function transaction.

### Never do this
- JS loop over eligible users
- JS calls claim one-by-one
- separate claim write first, reward write later across network round-trips

That pattern is slower, less reliable, and vulnerable to partial completion.

---

## 2.13 Idempotency strategy

The finalizer must be safe to run multiple times.

### Required idempotency rules
1. `milestone_rewards` primary key on `(user_id, milestone_id)` remains canonical
2. already claimed rows are skipped / unchanged
3. medal grant path must use `ON CONFLICT DO NOTHING`
4. energy path must only apply to rows newly claimed in the current execution

### Important implementation detail
Energy grant must be tied to the `claimed` CTE result from this run, not to all eligible users.
Otherwise repeated runs would re-grant energy.

---

## 2.14 Admin finalization route behavior

### Suggested flow
`POST /api/admin/activity/finalize`

1. authenticate admin
2. parse `activityId`
3. load activity config
4. verify end time has passed
5. extract normalized milestone payload
6. optionally validate all milestone rows
7. call `finalize_activity_milestone_rewards(...)`
8. write audit log
9. return summary

### Dry-run support
Highly recommended:
- `dryRun: true`
- returns how many users would be finalized per milestone
- does not mutate data

This is operationally very useful before first production execution.

---

## 2.15 Recommended validations before execution

Before finalization route calls the RPC, validate:

- activity exists
- activity already ended
- milestone list non-empty
- all milestone ids unique
- thresholds positive and unique
- reward types valid
- every `ENERGY` milestone has reward value
- every `MEDAL` milestone has badge/medal id

If any milestone config is malformed, fail the whole finalization request.

---

## 2.16 Recommended supporting indexes

Current schema is already decent, but for very large datasets these may help.

### Already useful
- `user_inventory(total_damage_dealt DESC)`
- PK on `milestone_rewards(user_id, milestone_id)`

### Optional optimization
If unclaimed settlement queries become frequent:

```sql
CREATE INDEX IF NOT EXISTS idx_milestone_rewards_claim_lookup
  ON public.milestone_rewards (milestone_id, is_claimed, is_locked, user_id);
```

This is optional because primary key + existing indexes may already be sufficient depending on scale.

---

## 2.17 Recommended audit logging

Every finalization run should write an admin audit trail:

- activity id
- triggered by which admin
- timestamp
- dryRun or live run
- per-milestone claimed counts
- success/failure

This is important because finalization is a financially/game-economy sensitive operation.

---

# Migration / Refactor Notes

## 3.1 Compatibility impact on frontend

After Phase 1, frontend milestone display logic should continue using `game/init` milestone definitions.

However, any UI that currently assumes:
- milestone claimability depends on boss HP

must be corrected to reflect:
- milestone claimability depends on `user total damage`

This especially affects any local red-dot or claimable-state computation based only on `currentHp`.

For example, current client reward store logic should eventually be updated so it no longer derives milestone claimability from boss HP alone.

---

## 3.2 Important naming clarification

The project currently uses milestone ids like `75 / 50 / 25`, which historically represented HP percentages.

For the corrected model, milestone ids should be treated as:
- opaque identifiers only

And claimability should always use:
- `threshold`

Never again derive business meaning from milestone id number itself.

---

# Recommended Implementation Order

## Step 1
Normalize milestone interpretation:
- `id` = identifier
- `threshold` = personal damage requirement

## Step 2
Rewrite `app/api/game/milestone/claim/route.ts`
- remove BOSS HP eligibility logic
- use user cumulative damage logic
- route to a proper DB RPC

## Step 3
Introduce new SQL RPC for personal milestone claim
- transactional
- idempotent
- reward-aware

## Step 4
Introduce admin finalizer route
- `app/api/admin/activity/finalize/route.ts`

## Step 5
Add bulk finalization RPC
- JSONB milestone payload
- SQL-side bulk settlement

## Step 6
Update frontend claimability calculations
- no more boss-HP-based milestone red dot

## Step 7
Add audit trail + dry-run support

---

# Final Recommendation

The Commander’s directive is correct: **fix the milestone model first, then build the auto-distribution engine**.

If we skip Phase 1 and implement auto-distribution immediately, we would automate the **wrong reward model**.

## Therefore:
- **Phase 1 is mandatory before Phase 2**
- the settlement engine must be **PostgreSQL-driven and set-based**
- the trigger must be **admin-invoked**, not cron-bound
- reward granting must be **transactional and idempotent**

---

## Approval Gate

Before coding begins, Commander should explicitly confirm these three design decisions:

1. `milestones[].threshold` is the canonical **personal total damage** threshold
2. `milestone_id` becomes an opaque identifier, no longer tied to `75/50/25` phase semantics
3. auto-distribution will be executed only through the new **admin finalization endpoint**

Once confirmed, implementation can proceed safely.