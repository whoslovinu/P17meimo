# Succubus Invasion - Final `blueprint.md`

## Mission Scope
This blueprint merges:
- **Agent A**: backend execution, schema, and concurrency-safe combat mutation.
- **Agent B**: App Router component architecture and battle UI tree.

Target stack:
- Next.js 15 (App Router)
- Tailwind CSS v4
- Framer Motion
- Supabase (PostgreSQL + RLS)
- Redis (Lua script for atomic boss HP mutation)

---

## Final Component Tree
```txt
app/
├── layout.tsx
├── page.tsx
├── api/
�?  └── action/
�?      └── attack/
�?          └── route.ts
└── components/
    └── features/
        ├── battle/
        �?  ├── BattleLayout.tsx
        �?  ├── BossHPBar.tsx
        �?  ├── Live2DCanvasContainer.tsx
        �?  └── ActionButtonBar.tsx
        └── ui/
            └── GlassButton.tsx
lib/
├── animations.ts
├── redis.ts
├── supabaseAdmin.ts
└── actions/
    ├── types.ts
    └── battleActions.ts
supabase/
└── migrations/
    └── 0001_initial_schema.sql
```

---

## Core Data Flow (Merged A + B)
1. Player taps action button (`hand` or `cylinder`) in `ActionButtonBar`.
2. `useOptimistic` decrements local inventory immediately for UI responsiveness.
3. Server action `performAttackAction(itemType)` calls `POST /api/action/attack`.
4. Route validates `item_type` (`item_hand` | `item_phallus`) and authenticates user identity header.
5. Backend uses Supabase **Service Role** to securely decrement inventory (`user_inventory`) with CAS retry.
6. Backend computes requested damage.
7. Backend executes Redis Lua atomic script to apply boss HP damage safely under concurrency.
8. Backend asynchronously writes combat log to `attack_logs` and syncs `global_boss.current_hp`.
9. API returns `requested_damage`, `actual_damage`, and `boss_current_hp`.

---

## Redis Atomic Lua Engine (Strict Sequence)
Required strict order:
- READ -> CHECK ZERO -> CALCULATE -> FLOOR LIMIT -> WRITE -> RETURN

Implemented contract:
- Input:
  - `KEYS[1]` = boss hp key (e.g. `event:boss:1:hp`)
  - `ARGV[1]` = computed damage
- Return:
  - `{actual_damage, new_hp}`

Behavior:
- If HP is nil or <= 0, return `{0,0}`.
- Never allow overkill underflow.
- If `new_hp < 0`, set `new_hp = 0` and `actual_damage = current_hp`.

---

## Supabase Migration and RLS
Migration file:
- `supabase/migrations/0001_initial_schema.sql`

Includes:
- Tables: `users`, `user_inventory`, `global_boss`, `attack_logs`, `milestone_rewards`
- RLS enabled on all tables
- Select policies: users read only own records (boss state public read)
- Mutations denied for client role (`WITH CHECK (false)` / `USING (false)`)
- Backend Service Role handles all writes

---

## Required Environment Variables (`.env.local`)
```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
REDIS_URL=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Developer Execution Commands (Cursor Terminal)
```bash
npm install
npm run dev
```

Supabase migration apply (choose one flow):
```bash
# If using Supabase CLI local/dev link
supabase db push

# Or run SQL directly in Supabase SQL Editor:
# supabase/migrations/0001_initial_schema.sql
```

---

## API Contract - `POST /api/action/attack`
Request body:
```json
{ "item_type": "item_hand" }
```
or
```json
{ "item_type": "item_phallus" }
```

Response success:
```json
{
  "ok": true,
  "data": {
    "item_type": "item_hand",
    "requested_damage": 14,
    "actual_damage": 12,
    "boss_current_hp": 9988
  }
}
```

Error examples:
- `401` missing user identity
- `400` invalid payload
- `404` inventory not found
- `409` item exhausted / inventory conflict
- `500` internal processing error

---

## Notes for Production Hardening
- Replace header-based user identity with JWT validation + `auth.uid()` propagation.
- Move inventory decrement and attack logging to Postgres RPC transaction for stronger consistency.
- Add idempotency key to prevent duplicate attack submissions on retries.
- Add metrics/tracing for Redis eval latency and conflict retry rates.
