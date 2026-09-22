# Badge Adapter — Architecture & Integration Guide

**Status:** Implemented (pre-production) — Hardening Addendum applied 2026-09-11
**Spec reference:** `g:\WECHAT\xwechat_files\wxid_zv1bn6rhy04422_eeab\msg\file\2026-09\第三方活动勋章接口(1).md`
**Adapter file:** `lib/services/badgeAdapter.ts`
**Integration point:** `app/api/battle/reward-claim/route.ts`
**Regression test:** `.audit/badge-adapter-regression.py`

---

## Hardening Addendum (2026-09-11)

The Commander issued four hardening changes after the first cut of this
integration. All four are implemented and verified by the regression suite:

| # | Hardening | Where |
|---|---|---|
| 1 | `request_id` generated ONCE per logical grant, reused across all retries via `crypto.randomUUID()` | `badgeAdapter.ts` → `randomRequestId()` + `fetchWithRetry(url, opts, requestId)` |
| 2 | Endpoints are required env vars, no defaults, fail-fast on module init | `badgeAdapter.ts` → `requiredEnv()` |
| 3 | Adapter does NOT decide HTTP status; route returns `INTERNAL_ERROR` / 500 to match ENERGY | `app/api/battle/reward-claim/route.ts` |
| 4 | Missing `medalId` is `CONFIG_ERROR` / 500 — never silently skipped | `app/api/battle/reward-claim/route.ts` |

---

## 1. Architecture

The Badge Adapter is a **thin outbound HTTP layer** that wraps the customer
Badge Detail and Badge Grant APIs behind the same security, retry, and
observability guarantees as the existing energy-reward webhook.

```
                        ┌─────────────────────────────────────┐
                        │  Customer Main Station              │
                        │  POST /webhook/activity/badge/...   │
                        └──────────────▲──────────────────────┘
                                       │
                                       │ HMAC-SHA256
                                       │ X-Webhook-Signature: sha256=<hex>
                                       │ X-Request-Id
                                       │ Content-Type: application/json; charset=utf-8
                                       │
                              ┌────────┴────────┐
                              │ badgeAdapter.ts │ ← single HMAC implementation
                              │  (this module)  │   via signWebhookPayload()
                              │                 │   shared with energy webhook
                              └────────▲────────┘
                                       │
   ┌────────────────────────────┐       │
   │  /api/battle/reward-claim  │───────┘
   │   rewardType === 'MEDAL'    │
   │   → grantBadge()            │
   │                             │
   │   rewardType === 'ENERGY'   │──→ outboundWebhook.ts (existing, unchanged)
   └─────────────────────────────┘
```

### Design principles

| Principle | Implementation |
|---|---|
| **No duplicated HMAC** | `signBody()` calls `signWebhookPayload()` from `lib/security/verifyWebhookSignature.ts`. The single HMAC implementation is reused. |
| **No duplicated secret validation** | `getWebhookSecret()` calls `requireWebhookSecret()` from the same module. ≥32 char floor enforced. |
| **No duplicated retry policy** | `fetchWithRetry()` mirrors `outboundWebhook.ts`: 3 retries, ≥5 s interval, 10 s timeout, 520 + network errors are retryable, 401 + others are not. |
| **No internal reward redesign** | `BattleLayout`, `SpineViewer`, energy logic, milestone unlock logic — all unchanged. Only the outbound transport for `MEDAL` was added. |
| **Idempotency via request_id** | `request_id = BADGE_GRANT_<user>_<badge>_<activity>_<randomUUID>` — generated once, reused across all retries. The Main Station uses INSERT IGNORE so duplicate grants are safe. |

---

## 2. Sequence — Badge Grant on MEDAL milestone claim

```
Player             /api/battle/reward-claim       badgeAdapter          Main Station
  │                       │                            │                       │
  │── POST ───────────────▶                            │                       │
  │   { user_id,          │                            │                       │
  │     milestone_id }    │                            │                       │
  │                       │                            │                       │
  │                       │ lookup activity + milestone │                       │
  │                       │ personal damage check      │                       │
  │                       │ (unchanged)                │                       │
  │                       │                            │                       │
  │                       │── resolve rewardType ──┐   │                       │
  │                       │   ENERGY → energyReward │   │                       │
  │                       │   MEDAL  → grantBadge ──┼──▶│                       │
  │                       │                          │   │── POST ──────────────▶
  │                       │                          │   │   { user_id,         │
  │                       │                          │   │     badge_id,        │
  │                       │                          │   │     activity_id,     │
  │                       │                          │   │     request_id }     │
  │                       │                          │   │                       │
  │                       │                          │   │◀── { code:200 } ──────
  │                       │                          │   │                       │
  │                       │◀── { ok: true } ─────────┘   │                       │
  │                       │                            │                       │
  │                       │ upsertMilestoneReward(     │                       │
  │                       │   claimed=true,            │                       │
  │                       │   reward_type='MEDAL',     │                       │
  │                       │   reward_value=badge_id )  │                       │
  │                       │                            │                       │
  │◀── 200 ───────────────┤                            │                       │
  │   { claimed: true }   │                            │                       │
```

### Failure branches

All adapter failures surface to the client as **`500 INTERNAL_ERROR`**
to match the ENERGY flow exactly. The adapter returns a structured
`reason` token in its logs only — it does NOT choose the HTTP status.

| Main Station response | Adapter result | reward-claim route response |
|---|---|---|
| `{ code: 200, data: true }` | `{ ok: true, requestId }` | 200 `{ claimed: true }` |
| `{ code: 401, ... }` (signature / IP) | `{ ok: false, reason: 'AUTH_FAILED' }` | 500 `INTERNAL_ERROR` |
| `{ code: 500, message: '用户不存在' }` | `{ ok: false, reason: 'USER_NOT_FOUND' }` | 500 `INTERNAL_ERROR` |
| `{ code: 500, message: '勋章不存在' }` | `{ ok: false, reason: 'BADGE_NOT_FOUND' }` | 500 `INTERNAL_ERROR` |
| `{ code: 500, message: '参数格式错误' }` | `{ ok: false, reason: 'INVALID_PARAM' }` | 500 `INTERNAL_ERROR` |
| `{ code: 520 }` | retried 3× then `NETWORK_ERROR` | 500 `INTERNAL_ERROR` |
| ECONNREFUSED / timeout / DNS error | retried 3× then `NETWORK_ERROR` | 500 `INTERNAL_ERROR` |
| HTTP non-2xx (transport-level) | `{ ok: false, reason: 'API_ERROR' }` | 500 `INTERNAL_ERROR` |
| Config: MEDAL milestone with no `medalId` | (route detects, never calls adapter) | 500 `CONFIG_ERROR` |

**Note:** the original draft returned **502 BADGE_GRANT_FAILED** for
adapter failures. After the Commander addendum, the route returns
**500 INTERNAL_ERROR** so that client-side error handling can be
identical for ENERGY and MEDAL flows.

**Invariant:** the DB `milestone_rewards` row is NOT updated unless the
remote grant succeeds. DB ↔ Main Station stay in sync. This mirrors the
ENERGY flow exactly.

---

## 3. Error Mapping

The Main Station returns a single `code` field (200, 401, 500). The adapter
maps each to one of these reason tokens, which the route layer surfaces
back to the client:

### `getBadgeDetail` reasons

| Spec code / message | Adapter reason |
|---|---|
| 200 + `data.status === 1` | `ok: true, data` (success) |
| 200 + `data.status === -1` or `null` | `INACTIVE` |
| 200 + `data === null` | `NOT_FOUND` |
| 401 | `AUTH_FAILED` |
| 500 + other | `API_ERROR` |
| Network / timeout after 3 retries | `NETWORK_ERROR` |

### `grantBadge` reasons

| Spec code / message | Adapter reason |
|---|---|
| 200 | `ok: true` (success — including duplicates, by spec design) |
| 401 | `AUTH_FAILED` |
| 500 + 用户不存在 | `USER_NOT_FOUND` |
| 500 + 勋章不存在 | `BADGE_NOT_FOUND` |
| 500 + *无效 / 参数错误 | `INVALID_PARAM` |
| 500 + other | `API_ERROR` |
| 520 | retried (rate-limit), then `NETWORK_ERROR` |
| Network / timeout after 3 retries | `NETWORK_ERROR` |

---

## 4. Retry Policy

Aligned with `outboundWebhook.ts` (energy webhook):

| Trigger | Action |
|---|---|
| `code === 520` (rate limit) | Retry, delay = `RETRY_DELAY_MS × attempt` (5 s, 10 s, 15 s) |
| Network error (ECONNREFUSED, ENOTFOUND, ETIMEDOUT, fetch-failed, AbortError) | Retry, same exponential delay |
| `code === 401` (auth failure) | **No retry** — surface immediately as `AUTH_FAILED` |
| `code === 500` (business error) | **No retry** — caller decides whether to retry (the spec treats most 500s as deterministic) |
| Per-attempt timeout | 10 s (`REQUEST_TIMEOUT_MS`) via `AbortController` |
| Max attempts | 3 (`MAX_RETRIES`) |

### Stable request_id reused across all retries (Hardening 1)

`request_id` is generated **once** at the start of `grantBadge()` using
`crypto.randomUUID()` and the SAME value is sent on every retry attempt:

```
request_id = BADGE_GRANT_<user>_<badge>_<activity>_<randomUUID>
```

The HTTP body bytes are byte-identical across retries, so the HMAC
signature stays valid for every attempt. The Main Station sees one
logical request regardless of how many times we retry internally.

This matches the Main Station's idempotency expectation: their
`INSERT IGNORE` is keyed on the user×badge pair, but having a stable
`request_id` per logical grant is what the customer asked for in
the spec.

The caller may override the `request_id` via `options.requestId`, but
the route layer does not need to — the adapter handles it.

### Why no client-side deduplication?

The Main Station side uses `INSERT IGNORE` and the `request_id` IS the
idempotency key. Adding a second dedup layer on our side would (a)
duplicate state, (b) potentially drop legitimate concurrent grants, and
(c) violate the directive: *"Do not implement additional deduplication
beyond existing request safeguards unless required."*

---

## 5. Configuration

### Environment variables (NEW — REQUIRED, no defaults)

The badge adapter **fails fast at module initialization** if either endpoint
is missing. There are no default URLs — the customer must supply the
production endpoints explicitly.

| Name | Purpose | Required | Default |
|---|---|---|---|
| `MAIN_STATION_BADGE_DETAIL_URL` | Detail endpoint | **YES** | *(none — must be set)* |
| `MAIN_STATION_BADGE_GRANT_URL`  | Grant endpoint  | **YES** | *(none — must be set)* |

If either variable is unset or empty, the adapter throws on first import:

```
[BadgeAdapter] FATAL: environment variable MAIN_STATION_BADGE_DETAIL_URL is required.
The badge adapter refuses to start without an explicit endpoint.
Set MAIN_STATION_BADGE_DETAIL_URL to the customer Main Station badge URL before deploying.
```

This is intentional: silently falling back to a hard-coded URL would route
real customer grants to a placeholder, which looks like a successful
callback but never reaches the Main Station.

### Environment variables (REUSED)

| Name | Purpose | Source |
|---|---|---|
| `WEBHOOK_SECRET` | HMAC signing key, shared with energy webhook | Required, ≥32 chars in production |

### No new secrets, no new env vars required for signing.

---

## 6. Files Changed

| File | Type | Purpose |
|---|---|---|
| `lib/services/badgeAdapter.ts` | **NEW** | Outbound HTTP client for badge APIs. After addendum: required env vars, stable `request_id` via `crypto.randomUUID` |
| `app/api/battle/reward-claim/route.ts` | MODIFIED | Imports `grantBadge`; calls it for MEDAL type; after addendum returns 500 `INTERNAL_ERROR` (matches ENERGY) on adapter failure and 500 `CONFIG_ERROR` on missing `medalId` |
| `.audit/badge-adapter-regression.py` | **NEW** | Static analysis regression check (~50 cases, all PASS). Extended with H1-H5 hardening cases |
| `BADGE_ADAPTER.md` | **NEW** | This document. Updated with Hardening Addendum section |

### Files NOT changed (per directive)

- `lib/services/outboundWebhook.ts` — energy webhook unchanged
- `lib/security/verifyWebhookSignature.ts` — HMAC primitives reused as-is
- `lib/db/pg.ts` — DB layer untouched
- `app/components/features/battle/SpineViewer.tsx` — battle rendering untouched
- `app/components/features/battle/BattleLayout.tsx` — battle orchestration untouched
- `app/components/features/battle/LoadingScreen.tsx` — UI untouched
- Any battle state machine, energy logic, milestone unlock logic

---

## 7. Backward Compatibility

| Aspect | Compatibility |
|---|---|
| Existing ENERGY reward flow | **100% preserved** — `sendMainStationEnergyReward` still called for `rewardType === 'ENERGY'`, same as before |
| Existing MEDAL flow | **Enhanced, not broken** — previously the `medalId` was stored in DB but never delivered to the customer; now it is delivered via the new grant API |
| Existing admin badge CRUD | **Unchanged** — `/api/admin/badge/*` routes operate on the local badge catalog only, do not interact with this adapter |
| Existing user-facing badge UI | **Unchanged** — `SubPageModal.tsx` displays the local `medalId` as before |
| Existing webhook secrets | **Reused** — `WEBHOOK_SECRET` is shared between energy and badge webhooks (customer confirmation) |
| Existing retry policy | **Reused** — same constants (`MAX_RETRIES=3`, `RETRY_DELAY_MS=5000`, `REQUEST_TIMEOUT_MS=10000`) |

---

## 8. Future Extensibility

The adapter is structured so that adding new badge-related outbound calls
is mechanical:

1. Add a new exported function (e.g. `revokeBadge`) following the same shape as `grantBadge`
2. Reuse `signBody()`, `fetchWithRetry()`, and `getWebhookSecret()` — no duplication
3. Map new spec error codes via `mapGrantErrorCode()` (or add a sibling mapper)
4. Wire into the route layer (or a new route) by calling the new exported function

The adapter deliberately exposes **typed result shapes** (`BadgeDetailSuccess | BadgeDetailFailure`, `BadgeGrantSuccess | BadgeGrantFailure`) so callers can pattern-match without string parsing.

If a Badge **List** API becomes available in the future, the spec does not
require list synchronization, but a `listBadges()` function can be added
following the same `getBadgeDetail` pattern. The directive explicitly
states the List API is **NOT required** for pre-production.

---

## 9. Verification Checklist

### Original integration (Phase 1-5)

| Verification | Method | Result |
|---|---|---|
| HMAC signature on raw body (no reordering) | `.audit/badge-adapter-regression.py` CASE C1 | PASS |
| No duplicated HMAC logic | CASE G1 (0 `createHmac` in adapter) | PASS |
| Header generation matches spec | CASE D1-D4 | PASS |
| Retry policy aligned with energy webhook | CASE E1 (3×, 5 s, 10 s) | PASS |
| Reason taxonomy complete | CASE F (8 markers) | PASS |
| `WEBHOOK_SECRET` reuse | CASE B1-B2 | PASS |
| Grant fires BEFORE DB upsert | CASE I1 | PASS |
| Config error (empty medalId) handled | CASE J1-J2 | PASS |
| `tsc --noEmit -p tsconfig.json` clean | shell | PASS |

### Hardening Addendum (2026-09-11)

| # | Hardening | Regression cases | Result |
|---|---|---|---|
| H1 | Stable `request_id` reused across all retries | H1.1-H1.5 | PASS |
| H2 | Required env vars, fail-fast on init, no default URLs | H2.1-H2.5 | PASS |
| H3 | ENERGY-consistent error semantics (500 `INTERNAL_ERROR`, not 502) | H3.1-H3.3 | PASS |
| H4 | Missing `medalId` is `CONFIG_ERROR`, never silently skipped | H4.1-H4.3 | PASS |
| H5 | Documentation updated | H5.1-H5.4 | PASS |

Run the regression suite any time with:

```
py -3 .audit/badge-adapter-regression.py
```
