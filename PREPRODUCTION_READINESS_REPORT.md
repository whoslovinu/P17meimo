# PREPRODUCTION_READINESS_REPORT.md

> Generated: 2026-09-11
> Phase: P1-77 Badge Ownership Migration — Pre-Production

---

## Executive Summary

Badge metadata preview has been migrated from the local `public.badges` table to the customer's Main Station via `BadgeAdapter.getBadgeDetail()`. The admin UI no longer stores or queries badge metadata locally.

**Deployment is BLOCKED** pending customer-provided URLs and HMAC secret.

---

## Phase 1: Document Audit Results

### Source Document
`第三方活动勋章接口.md` — customer-provided specification

| Item | In Document? | Value from Document | Our Finding |
|---|---|---|---|
| Host / Domain | ❌ NOT PRESENT | N/A | Must be provided by customer |
| Full Detail URL | ❌ NOT PRESENT | Path only: `/webhook/activity/badge/detail` | Must be provided by customer |
| Full Grant URL | ❌ NOT PRESENT | Path only: `/webhook/activity/badge/grant` | Must be provided by customer |
| HMAC Header | ✅ YES | `X-Webhook-Signature: sha256=<hex>` | Fully specified |
| HMAC Algorithm | ✅ YES | `HMAC-SHA256(raw_body_utf8, secret).hexdigest()` | Fully specified |
| Request-Id Header | ✅ YES | `X-Request-Id` (optional, for logging) | Fully specified |
| Content-Type | ✅ YES | `application/json; charset=utf-8` | Fully specified |
| Detail Request Body | ✅ YES | `{"badge_id": "10021"}` | Fully specified |
| Detail Response Fields | ✅ YES | `badge_id`, `name`, `icon`, `description`, `status` | Fully specified |
| Grant Request Body | ✅ YES | `user_id`, `badge_id`, `activity_id`, `request_id` | Fully specified |
| Grant Response | ✅ YES | `{"code": 200, "data": true}` | Fully specified |
| Success Code | ✅ YES | `code: 200` | Fully specified |
| Auth Failure Code | ✅ YES | `code: 401` | Fully specified |
| Biz Failure Code | ✅ YES | `code: 500` | Fully specified |
| Error Messages | ✅ YES | `勋章不存在`, `签名验证失败`, etc. | Fully specified |
| Timeout Requirement | ❌ NOT PRESENT | N/A | Unknown — we default to 10s |
| Retry Policy | ❌ NOT PRESENT | N/A | Not specified; we implement 3× retry |
| IP Whitelist Requirement | ✅ YES | "出口 IP 需加白" | Explicit — customer must whitelist our outbound IP |
| Idempotency | ✅ YES | "同一用户同一勋章重复调用仍返回成功" | Confirmed safe for retries |

---

## Phase 2: Code Changes Completed

### New Files

| File | Purpose | Status |
|---|---|---|
| `app/api/admin/badge/preview/route.ts` | Thin proxy → `getBadgeDetail()` from Main Station. GET `?badge_id=`. Returns name + icon + description. Zero writes, zero local DB. | ✅ Written |
| `PREPRODUCTION_DEPLOYMENT_PLAN.md` | Deployment procedure | ✅ Written |
| `PREPRODUCTION_INTEGRATION_CHECKLIST.md` | 50-point verification checklist | ✅ Written |
| `CUSTOMER_REQUIRED_INFORMATION.md` | Customer-facing information request | ✅ Written |

### Modified Files

| File | Change | Status |
|---|---|---|
| `app/admin/activities/[id]/config/page.tsx` | `MilestoneCard` fetches from `/api/admin/badge/preview` instead of local DB. Preview now shows name + icon + description + badge_id. | ✅ Modified |
| `app/admin/layout.tsx` | 勋章管理 sidebar nav entry removed. `Award` import removed. | ✅ Modified |
| `app/admin/page.tsx` | 勋章管理 dashboard shortcut removed. `Award` import removed. | ✅ Modified |

### Preserved (Phase C pending)

| Item | Status |
|---|---|
| `app/admin/badges/*` CRUD pages (4 files) | ✅ Preserved — nav removed, URLs still valid |
| `app/api/admin/badge/*` routes (4 files) | ✅ Preserved |
| `lib/db/pg.ts` badge functions | ✅ Preserved — not called by new code |
| `public.badges` table + migration | ✅ Preserved — not queried by new code |
| `lib/services/badgeAdapter.ts` | ✅ Preserved — `grantBadge()` still used by `reward-claim` |

---

## Phase 3: TypeScript Build

```
npx tsc --noEmit
→ Exit code: 0
→ 0 errors ✅
```

---

## Phase 4: Customer Gap Analysis

### REQUIRED (customer must provide before deployment)

| # | Item | Evidence | Blocking? |
|---|---|---|---|
| R1 | Full Badge Detail URL | Spec has path only. Full URL not in spec. | ✅ YES |
| R2 | Full Badge Grant URL | Spec has path only. Full URL not in spec. | ✅ YES |
| R3 | Webhook HMAC Secret | Referenced as "双方约定的secret". Not in spec. | ✅ YES |
| R4 | Our outbound IP to whitelist | Spec says "出口 IP 需加白". We need to provide our IP. | ✅ YES |

### OPTIONAL (nice to have before deployment)

| # | Item | Evidence | Blocking? |
|---|---|---|---|
| O1 | Timeout requirement | Spec doesn't specify. Our 10s default is reasonable. | ❌ NO |
| O2 | Retry policy compatibility | Spec confirms idempotency. Our retry is safe. | ❌ NO |
| O3 | activity_id format | We send numeric string. May need prefix. | ❌ NO |
| O4 | Test badge IDs | Example `10021` in spec. Ask for valid/invalid pair. | ❌ NO |

### UNKNOWN (cannot determine without customer confirmation)

| # | Item | Evidence | Blocking? |
|---|---|---|---|
| U1 | Main Station host/domain | Not in spec. Only path. | ✅ YES |
| U2 | Whether Detail and Grant share the same host | Could be separate services. | ✅ YES |
| U3 | Production vs staging endpoint | Customer may have separate URLs. | ✅ YES |

---

## Phase 5: Deployment Readiness

### Readiness Gate

| Gate | Status | Notes |
|---|---|---|
| TypeScript build | ✅ PASS | 0 errors |
| Code changes complete | ✅ PASS | Phase A + B complete |
| `MAIN_STATION_BADGE_DETAIL_URL` set | ❌ BLOCKED | Customer must provide |
| `MAIN_STATION_BADGE_GRANT_URL` set | ❌ BLOCKED | Customer must provide |
| `WEBHOOK_SECRET` confirmed | ❌ BLOCKED | Customer must confirm |
| Our outbound IP whitelisted | ❌ BLOCKED | Customer must whitelist |
| PM2 configured | ✅ READY | `ecosystem.config.js` loads from `/etc/repark/owner.env` |
| Deployment script | ✅ READY | `deploy.sh` in place |
| Rollback plan | ✅ READY | Documented in `PREPRODUCTION_DEPLOYMENT_PLAN.md` |

### Deployment Decision

```
❌ CANNOT DEPLOY — 4 blocking items outstanding (R1, R2, R3, R4)
```

**All preparation is complete.** When customer provides:
1. Full Badge Detail URL
2. Full Badge Grant URL
3. HMAC Secret confirmation
4. Outbound IP whitelist confirmation

...deploy immediately using `PREPRODUCTION_DEPLOYMENT_PLAN.md`.

---

## Documents Produced

| Document | Location | Purpose |
|---|---|---|
| `PREPRODUCTION_DEPLOYMENT_PLAN.md` | project root | Step-by-step deploy + rollback |
| `PREPRODUCTION_INTEGRATION_CHECKLIST.md` | project root | 50-point pre-production sign-off checklist |
| `CUSTOMER_REQUIRED_INFORMATION.md` | project root | Customer-facing information request tracker |
| `PREPRODUCTION_READINESS_REPORT.md` | project root | This document — overall readiness summary |

---

## Immediate Next Steps

1. **Send customer message** (template in `CUSTOMER_REQUIRED_INFORMATION.md`) requesting items R1–R4
2. **Identify our outbound IP** — run on the EC2 host:
   ```bash
   curl -s ifconfig.me
   ```
   Send this IP to customer for whitelist
3. **When customer responds** — update `CUSTOMER_REQUIRED_INFORMATION.md` with received values
4. **When all R1–R4 confirmed** — execute `PREPRODUCTION_DEPLOYMENT_PLAN.md`
5. **After deploy** — run `PREPRODUCTION_INTEGRATION_CHECKLIST.md` and get commander sign-off
