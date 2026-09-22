# 📜 PROJECT GENESIS REPORT — P17 H5 魅魔来袭 (Boss Battle)

> **Reconnaissance Date**: 2026-06-29
> **Reconnaissance Mode**: READ-ONLY Vanguard Scan
> **Status**: Handover from prior outsourcing team. Zero modifications performed.

---

## 1. [TECH STACK BLUEPRINT]

### 1.1 Core Framework & Runtime
| Layer | Technology | Version |
|---|---|---|
| Meta-framework | **Next.js** (App Router, not Pages Router) | `^15.5.14` |
| Runtime | Node.js + React `19.2.4` | Strict TS `^5`, target `ES2017` |
| Path alias | `@/* → ./*` (project root) | — |

**Files confirm App Router**: `app/layout.tsx`, `app/page.tsx`, `app/battle/page.tsx`, and ~30 `app/api/**/route.ts` handlers. No `pages/` directory.

### 1.2 Animation & Rendering Engine
| Lib | Version | Role |
|---|---|---|
| **`pixi.js`** | `^8.17.1` | WebGL renderer (v8 API — `Application.init()`, `Assets`, `Container`) |
| **`@esotericsoftware/spine-pixi-v8`** | `^4.2.108` | Spine runtime matched to PIXI v8 |
| `framer-motion` | `^12.38.0` | UI micro-animations (modal, EndPage) |
| `tw-animate-css` | `^1.4.0` | Tailwind v4 animate plugin |

> ⚠️ Spine `4.2.108` is the bleeding-edge runtime; the codebase hard-patches `Skeleton.updateWorldTransform(physics)` in `app/layout.tsx` ("ROOT BOOT Spine Physics Shield") because the new signature broke the old call sites. This is a hotfix, not a fix.

### 1.3 Audio Engine
| Lib | Version | Role |
|---|---|---|
| **`howler`** | `^2.2.4` | Singleton `AudioManager` (BGM + Voice tracks) |
| `dayjs` | `^1.11.20` | UTC+8 timezone math (`task_progress` resets) |

Audio state lives in a **Zustand dual-track store** (`app/lib/audioStore.ts`): BGM and Voice are independently muted, persisted to `localStorage` (`repark_audio_state_v2`). The `AudioManager` subscribes once to `isVoiceMuted` changes and kills the active voice clip in real-time.

### 1.4 State, Styling, UI
| Concern | Implementation |
|---|---|
| Global state | **`zustand`** `^5.0.12` — `audioStore`, `modalStore`, `toastStore`, `transitionStore`, `rewardStore` |
| Styling | **Tailwind CSS v4** (`@tailwindcss/postcss` `^4.2.2`), CSS variables, `tailwind-merge` + `clsx` + `class-variance-authority` |
| UI primitives | `shadcn` `^4.8.0`, `@base-ui/react` `^1.5.0`, `lucide-react` `^1.16.0`, `sonner` `^2.0.7` |
| Forms/Validation | `zod` `^4.4.3` (used at `/api/admin/login`) |
| Carousels | `embla-carousel-react` `^8.6.0`, `swiper` `^12.1.4` |

### 1.5 Data Layer (THE CRITICAL PART)
| Component | Library | Role |
|---|---|---|
| **AWS RDS PostgreSQL** | `pg` `^8.21.0` | **Single source of truth**. Pool via `lib/db/postgres.ts` (`max:10`, `statement_timeout:10s`). Local dev: SSH tunnel `127.0.0.1:5433` via `scripts/dev_tunnel.mjs`. Prod: `DATABASE_URL` env. |
| **AWS ElastiCache Redis** | `ioredis` `^5.10.1` | Hot cache: boss HP, rate limits, idempotency nonces, webhook replay guard, daily task progress. Local: `rediss://127.0.0.1:6380`. Prod: `rp1-bkmbmc.serverless.use1.cache.amazonaws.com:6379` (TLS). |
| **Supabase** (`@supabase/supabase-js` `^2.100.0`) | ⚠️ **DECOMMISSIONED per `.env.local.example`** — the prior SaaS project was retired. The client exists, the `.env.example` tombstone is kept, and the migration SQL files (`supabase/migrations/00–13`) still represent the **logical schema**, but runtime now points at AWS RDS only. |
| Mock fallback | `mock_db_users.json`, `mock_db_activities.json` | Local-dev placeholder when neither Supabase nor RDS is up. |

### 1.6 Infra Tooling
- `ssh2` `^1.17.0` — programmatic SSH tunnel to RDS/Redis bastion
- `playwright` `^1.59.1` — E2E tests
- `dotenv` `^17.3.1`, `adm-zip` `^0.5.16`

---

## 2. [ARCHITECTURE TOPOLOGY]

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER (H5 / Admin)                           │
│                                                                              │
│  ┌──────────────┐   ┌─────────────────┐    ┌────────────────────────────┐  │
│  │  / (home)    │   │  /battle (game) │    │  /admin/* (dashboard)      │  │
│  │  HomePage    │   │  BattleLayout   │    │  AdminLayout + login       │  │
│  │  Banners     │   │  SpineViewer    │    │  Activity / Banner / Users │  │
│  └──────┬───────┘   └────────┬────────┘    └─────────────┬──────────────┘  │
│         │                    │                            │                  │
│         │              middleware.ts                     │                  │
│         │              (cookie gate)            cookie 'admin_token'        │
└─────────┼────────────────────┼────────────────────────────┼─────────────────┘
          │                    │                            │
          ▼                    ▼                            ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│              NEXT.JS 15 APP-ROUTER (Edge / Node Runtime mix)                  │
│                                                                              │
│  /api/game/init           ← public battle bootstrap                          │
│  /api/battle/init         ← authenticated state hydration (cookie+bearer)    │
│  /api/action/attack       ← ATOMIC attack (Redis Lua → PG sync)             │
│  /api/battle/task-claim   ← daily task claim                                 │
│  /api/battle/reward-claim ← milestone reward                                 │
│  /api/battle/leaderboard  ← real-time ranking                                │
│  /api/banner*, /api/game/banners  ← public banner carousel                   │
│  /api/admin/login|logout|validate  ← HMAC-SHA256 token issuance              │
│  /api/admin/banner*, /activity*, /user*, /boss*, /config*  ← admin CRUD     │
│  /api/webhook/user-action ← signed webhook receiver                          │
│  /api/internal/startup    ← dev-only init hook                               │
│                                                                              │
│  lib/auth.ts           ← Cookie/Bearer extractor, dev fallback              │
│  lib/adminAuth.ts      ← requireAdminAuth HMAC guard                        │
│  lib/supabaseAdmin.ts  ← Supabase client factory (deprecated but present)   │
│  lib/redis.ts          ← ioredis singleton + Lua attack script              │
│  lib/db/postgres.ts    ← pg.Pool singleton (single allowed entry)            │
│  lib/sync.ts           ← PG/Redis sync orchestrator                          │
│  lib/security/*        ← webhook HMAC, audit log                             │
│  app/lib/audioStore.ts, modalStore.ts, toastStore.ts ← Zustand stores        │
└──────────────────────────┬───────────────────────┬───────────────────────────┘
                           │                       │
                           ▼                       ▼
          ┌────────────────────────┐    ┌────────────────────────────────────┐
          │  AWS RDS PostgreSQL    │    │  AWS ElastiCache Serverless Redis  │
          │  (via SSH tunnel)      │    │  (TLS)                              │
          │                        │    │                                     │
          │  Tables:               │    │  Keys:                              │
          │  • activities          │    │  • boss:hp, boss:max_hp            │
          │  • user_inventory      │    │  • rate:{userId}   (1s TTL)        │
          │  • task_progress       │    │  • idempotency:{userId}:{nonce}    │
          │  • milestone_rewards   │    │  • repark:activity:config          │
          │  • boss_status         │    │  • webhook:processed:{eventId}     │
          │  • banners             │    │  • user:{userId}:tasks:{YYYYMMDD}  │
          │  • admin_users         │    └────────────────────────────────────┘
          │  (schema in            │
          │   supabase/migrations) │
          └────────────────────────┘
```

**Front-end ↔ Back-end contract**:

- The game frontend is a **pure SPA after mount** — every state transition goes through `/api/action/attack`, `/api/battle/init`, `/api/battle/reward-claim`, `/api/battle/task-claim`, `/api/boss/status`, `/api/battle/leaderboard`.
- `BattleLayout` is the **Single Source of Truth** for the entire battle UI; it polls `/api/battle/init` every **3 s** + on `visibilitychange` to pick up admin HP modifications.
- The **atomic attack loop** runs in Redis (`ATOMIC_ATTACK_LUA` in `lib/redis.ts`): idempotency → rate-limit (1 s/user) → HP deduct → all in one round-trip; PG is then synced *eagerly* via `lib/sync.ts`.
- **Auth** is split: clients carry a `uid` cookie set by an external "Main Station" portal (`NEXT_PUBLIC_AUTH_COOKIE_NAME`, default `uid`). Production middleware hard-redirects `/battle` to `NEXT_PUBLIC_MAIN_STATION_URL` when missing.
- **Admin** auth uses an **HMAC-SHA256 signed cookie** (`admin_token`, HttpOnly + SameSite=Strict + Secure-in-prod, 24h TTL).

---

## 3. [CRITICAL OBSERVATIONS]

### 🔴 1. Spine runtime hot-patch in `app/layout.tsx`
The file **patches `Skeleton.prototype.updateWorldTransform`, `Skeleton.prototype.physics`, `SkeletonData.prototype.physics`, and `AnimationState.prototype.apply`** at the top of the module graph ("ROOT BOOT Spine Physics Shield v3"). This is a workaround for `@esotericsoftware/spine-pixi-v8@4.2.108`'s new required `physics` argument. **Any upgrade to spine-core must be coordinated with this shield**, or the app will silently throw on every animation tick.

### 🔴 2. `lucide-react ^1.16.0` is **suspiciously low**
The current published `lucide-react` major versions are `0.x` (it stayed on `0.x` for years). `^1.16.0` either is a private mirror, an internal fork, or a typo that npm has silently resolved. **Verify the package source before any rebuild** — `npm install` may fail in CI without an explicit registry. Note: the codebase uses icons like `Lock`, `LayoutDashboard`, `CalendarDays`, `Trophy`, `Zap`, `Gem`, `TrendingUp` etc. — all standard lucide names — so the API surface looks compatible.

### 🔴 3. `getSupabaseAdmin()` is dead code in production but still shipped
`lib/supabaseAdmin.ts` validates `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. In production **without** those vars, the attack handler returns `503 SERVICE_UNAVAILABLE` and the entire battle loop dies. The `.env.local.example` clearly marks Supabase as **DECOMMISSIONED**, yet multiple files (`app/api/action/attack/route.ts`, `app/api/battle/init/route.ts`, `app/page.tsx`, `app/battle/page.tsx`) still call `getSupabaseAdmin()` as their fallback. **Either remove all `supabase` paths or restore the project** — the current state is a minefield.

### 🟠 4. Dev-mode JSON DB writes to the filesystem from API routes
`app/api/admin/activity/update/db.ts` reads/writes `mock_db_activities.json`; `app/api/action/attack/route.ts` calls `writeDB()` on every successful attack in `NODE_ENV === 'development'`. This is fine for solo development but **breaks under any Vercel-style read-only filesystem** and silently no-ops or throws on serverless platforms.

### 🟠 5. `middleware.ts` only protects `/admin/*` and `/battle`. `/api/game/*` and `/api/admin/*` are NOT gated
- `/api/game/init` is a public read endpoint — that's intentional.
- `/api/admin/*` handlers must each call `requireAdminAuth()` (`lib/adminAuth.ts`); if any route forgets, the whole admin plane is exposed. A grep of every admin route for `requireAdminAuth` should be the **first audit step**.

### 🟠 6. `BattleLayout.tsx` is a 1,160-line god-component with `window` globals and `useImperativeHandle` shims
It mounts `SpineViewer`, hooks `(window as any).triggerSpineAttack` / `triggerHitFeedback` / `triggerFormSwitchFlash`, polls `/api/battle/init` every 3 s, manages modal state, audio lock, optimistic attack rollbacks, server-time offset, and pre-warm logic — **all in one file**. The "V5/V6/FIX T-/TC-/A1–A6" comment lineage reveals at least 6 layers of retrofit.

### 🟡 7. Two `BGMController.tsx` files, two `SpineViewer.tsx` files, two `BattleLayout.tsx` files
Paths with **forward slashes** (`app/components/features/battle/...`) and **backslashes** (`app\components\features\battle\...`) coexist in the file listing. On Windows this resolves to the same path, but it suggests incomplete cleanup from a tooling migration — review for actual duplicate logic.

### 🟡 8. Daily task reset relies on `dayjs().tz('Asia/Shanghai')`
Both client and server correctly use UTC+8, but **no cron / `pg_cron` is wired up** for PostgreSQL daily reset — only Redis keys TTL-expire. A `pg_cron` migration is referenced in `lib/redis.ts` comments (`reset_daily_tasks()`) but **does not exist in `supabase/migrations/`**.

### 🟡 9. `next.config.ts` is empty
No security headers, no CSP, no `images.domains`, no `experimental.serverActions`. The auth-redirect logic, the audio base-URL config, and the font loading all happen by convention in the application code instead.

### 🟡 10. `WEBHOOK_SECRET` is set to a placeholder in `.env.local.example`
Marked `TODO(p2)` — webhook signature verification (`lib/security/verifyWebhookSignature.ts`) is a real surface that, if left at `your_webhook_secret_here_minimum_32_chars`, will accept forged requests.

---

## 4. [ENTRY POINTS]

### 🎮 Main Game Layout
| File | Role |
|---|---|
| `app/layout.tsx` | Root `<html>`, font, **`Spine Physics Shield`** monkey-patch, modal portal anchor. |
| `app/page.tsx` | Home page (banner carousel, kill switch). |
| `app/battle/page.tsx` | Server Component — calls `/api/game/init` SSR, hydrates `<BattleLayout>`. |
| **`app/components/features/battle/BattleLayout.tsx`** | **The 1,160-line god-component.** Owns: HP, inventory, attack lock, modal, audio lock, server-time sync, form unlocking, polling, optimistic attacks. |
| `app/components/features/battle/SpineViewer.tsx` | PIXI v8 + spine-pixi-v8 renderer; exposes `triggerAttack()`, `forceResetAllModels()` via `useImperativeHandle`. Stage registry, halo, screen shake, residual-slot eraser, pre-warm. |
| `app/components/features/battle/BGMController.tsx` | Phase-aware BGM (per stage index). |
| `app/components/features/battle/WeaponBar.tsx` | The two attack buttons. |
| `app/lib/audio/AudioManager.ts` | Howler singleton; voice clip orchestration with 6-s hard ceiling. |
| `app/lib/audioStore.ts` | Zustand dual-track audio state. |

### 🛡️ Admin Dashboard
| File | Role |
|---|---|
| `middleware.ts` | Cookie gate for `/admin/*` (except `/admin/login`) and `/battle`. |
| `app/admin/layout.tsx` | Sidebar nav (`控制台 / 活动 / Banner / 用户管理`), `localStorage` session check. |
| `app/admin/login/page.tsx` | Password form, posts to `/api/admin/login`. |
| **`app/admin/page.tsx`** | **Dashboard** — stats cards, quick links to Activities / Users / Monitor. **All values are currently hard-coded to 0** (no live data wired up yet). |
| `app/admin/activities/page.tsx` | Activity CRUD list. |
| `app/admin/activities/[id]/config/page.tsx` | Per-activity config editor. |
| `app/admin/banners/page.tsx` | Banner CRUD. |
| `app/admin/users/page.tsx` | User search, prop adjustment, force-unlock. |
| `app/admin/monitor/page.tsx` | Redis / PG status, live data. |
| `app/api/admin/login/route.ts` | HMAC-SHA256 token issuance (timing-safe compare, rate-limited). |
| `app/lib/adminAuth.ts` + `app/lib/adminToken.ts` | HMAC guard + verifier. |

---

## ⚡ 5-SECOND SUMMARY FOR THE COMMANDER

- **Stack**: Next.js 15 App Router + PIXI v8 + Spine 4.2.108 (hot-patched) + Howler + Zustand + Tailwind 4 + **AWS RDS Postgres + ElastiCache Redis** (Supabase is dead).
- **Two apps in one repo**: H5 battle game at `/battle` and admin dashboard at `/admin/*`.
- **Auth**: external `uid` cookie for users, HMAC-SHA256 `admin_token` for admins.
- **Atomicity**: every attack runs through a Redis Lua script that combines idempotency, 1-second rate limit, and HP deduct in one round-trip.
- **Hot minefields**: Spine physics monkey-patch, dead-but-shipped Supabase code, JSON DB writes from dev API routes, admin auth scattered across routes (no central guard), empty `next.config.ts`.

> Routing to Agent 1 [ENGINEERING]… Reconnaissance complete. Awaiting Commander orders.