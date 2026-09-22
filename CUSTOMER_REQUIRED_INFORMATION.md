# CUSTOMER_REQUIRED_INFORMATION.md

> Generated: 2026-09-11
> Updated: 2026-09-11 (Deployment Standby Mode — server `98.93.252.250`)
> Source: `第三方活动勋章接口.md` (customer provided specification)
> Purpose: Track every piece of information we need from the customer before deploying badge integration

---

## Updated Facts (2026-09-11 22:57 UTC+8)

| Item | Status | Source |
|---|---|---|
| Production server IP | ✅ CONFIRMED | `98.93.252.250` |
| ENERGY integration | ✅ DEPLOYED & WORKING | Production state |
| WEBHOOK_SECRET (shared with ENERGY) | ✅ CONFIRMED | Customer: "鉴权和之前一样" |
| Badge Detail URL | ❌ MISSING | Customer to provide |
| Badge Grant URL | ❌ MISSING | Customer to provide |

**Remaining blocking items: 2 (both URLs only).**

---

## How to Use This Document

This document is the **single source of truth** for all customer-facing requests.
Every item is numbered. When the customer provides information, mark the status as **PROVIDED** with the received value.
Do not guess. Do not assume. Update this document and re-run the readiness check.

---

## 1. Badge Detail Endpoint

| Field | Value |
|---|---|
| **Item** | Full URL for Badge Detail API |
| **From spec** | `POST /webhook/activity/badge/detail` (path only) |
| **Required format** | Full HTTPS URL, e.g. `https://pre.xxx.com/webhook/activity/badge/detail` |
| **Status** | ❌ MISSING |
| **Our env var** | `MAIN_STATION_BADGE_DETAIL_URL` |
| **Who confirms** | Customer integration team |
| **Notes** | Customer must provide the **full domain + path**. Path is in spec; host/domain is not. |

---

## 2. Badge Grant Endpoint

| Field | Value |
|---|---|
| **Item** | Full URL for Badge Grant API |
| **From spec** | `POST /webhook/activity/badge/grant` (path only) |
| **Required format** | Full HTTPS URL, e.g. `https://pre.xxx.com/webhook/activity/badge/grant` |
| **Status** | ❌ MISSING |
| **Our env var** | `MAIN_STATION_BADGE_GRANT_URL` |
| **Who confirms** | Customer integration team |
| **Notes** | Customer must provide the **full domain + path**. Path is in spec; host/domain is not. |

---

## 3. Webhook HMAC Secret

| Field | Value |
|---|---|
| **Item** | Shared HMAC-SHA256 secret for webhook signature verification |
| **From spec** | "双方约定的secret" (referenced in curl examples) |
| **Required format** | String ≥ 32 characters. Recommended: 64+ hex characters |
| **Status** | ❌ NOT YET CONFIRMED |
| **Our env var** | `WEBHOOK_SECRET` |
| **Who confirms** | Customer integration team |
| **Notes** | Must match exactly on both sides. If customer changes this later, deployment must be updated. |
| **Generator (for our side)** | `openssl rand -hex 32` |

---

## 4. Domain / Host of Main Station

| Field | Value |
|---|---|
| **Item** | Domain or IP of customer's Main Station |
| **From spec** | None |
| **Required format** | Domain (`pre.xxx.com`) or IP address |
| **Status** | ❌ UNKNOWN — needed to construct full URLs |
| **Notes** | Once `MAIN_STATION_BADGE_DETAIL_URL` and `MAIN_STATION_BADGE_GRANT_URL` are provided, this is resolved. |

---

## 5. Our Outbound IP → Customer's Whitelist

| Field | Value |
|---|---|
| **Item** | Our outbound IP — already provided to customer |
| **From spec** | "出口 IP 需加白" |
| **Status** | ✅ PROVIDED — `98.93.252.250` |
| **Notes** | Customer is responsible for whitelisting this IP on their side. Our side has nothing more to do. |

---

## 6. Existing Badge IDs for Testing

| Field | Value |
|---|---|
| **Item** | At least 1 valid badge_id to use in smoke testing |
| **From spec** | Example value `10021` used in all examples |
| **Required format** | Decimal numeric string, e.g. `"10021"`, `"10022"` |
| **Status** | ❓ UNKNOWN — test with `10021` if available |
| **Our test plan** | Use `10021` as first smoke test value |
| **Notes** | Customer may have a test environment with known badge IDs. Ask for at least 2 (one active, one invalid) for checklist testing. |

---

## 7. Timeout Requirement

| Field | Value |
|---|---|
| **Item** | Acceptable timeout for badge Detail + Grant API calls |
| **From spec** | None |
| **Required format** | Milliseconds (integer) |
| **Status** | ❌ UNKNOWN — we default to 10,000ms (10s) |
| **Our current value** | 10,000ms (10s) per attempt, 3 retries with 5s interval |
| **Notes** | If customer's API SLA is lower (e.g. 3s), we may need to reduce timeout. If unknown, we proceed with 10s default. |

---

## 8. Retry Policy

| Field | Value |
|---|---|
| **Item** | Whether our retry logic is compatible with their API |
| **From spec** | None explicitly stated |
| **Required format** | Confirmation that `grantBadge` retries are safe |
| **Status** | ✅ IMPLEMENTED (our side) |
| **Our implementation** | `MAX_RETRIES=3`, 5s between attempts, `request_id` is stable and reused across retries |
| **Notes** | Spec says "同一用户同一勋章重复调用仍返回成功" — our retry of `grantBadge` is safe because the API is idempotent. Badge Detail is read-only; retry is safe. |

---

## 9. Badge Grant — activity_id Format

| Field | Value |
|---|---|
| **Item** | What value to pass as `activity_id` in Badge Grant request |
| **From spec** | `"activity_id": "activity_xxx"` (example format) |
| **Required format** | String — exact format depends on customer's system |
| **Status** | ❓ PARTIAL — we pass `String(activeActivityId)` |
| **Our current value** | We send the numeric activity ID as a string, e.g. `"1"` |
| **Notes** | Customer may expect a different format (e.g. `activity_xxx`). This needs confirmation before smoke testing grant flow. |

---

## 10. Energy Reward Webhook URL (Existing)

| Field | Value |
|---|---|
| **Item** | Full URL for energy reward webhook |
| **From spec** | None (existing integration) |
| **Status** | ⚠️ UNVERIFIED IN PRODUCTION |
| **Our env var** | `MAIN_STATION_ADD_ENERGY_URL` |
| **Notes** | Energy webhook was implemented earlier. Must confirm it still works before deploying badge changes (no regression). |

---

## 11. NEXT_PUBLIC_MAIN_STATION_URL

| Field | Value |
|---|---|
| **Item** | Main Station login URL (for H5 redirect) |
| **From spec** | None |
| **Status** | ⚠️ IN `.env.example` but not confirmed in production |
| **Our env var** | `NEXT_PUBLIC_MAIN_STATION_URL` |
| **Notes** | Must be confirmed for H5 redirect flow (unauthenticated users → login page). |

---

## Summary Table

| # | Item | Status | Blocking? |
|---|---|---|---|
| 1 | Badge Detail URL | ❌ MISSING | ✅ YES — cannot deploy badge preview |
| 2 | Badge Grant URL | ❌ MISSING | ✅ YES — cannot deploy badge grant |
| 3 | Webhook HMAC Secret | ✅ CONFIRMED (shared with ENERGY) | ❌ NO |
| 4 | Domain / Host | ❌ UNKNOWN — resolved when URLs provided | ✅ YES — same as 1, 2 |
| 5 | IP Whitelist | ✅ PROVIDED — `98.93.252.250` | ❌ NO |
| 6 | Test Badge IDs | ❓ UNKNOWN | ❌ NO — we can test with example values |
| 7 | Timeout Requirement | ❓ UNKNOWN | ❌ NO — default 10s is reasonable |
| 8 | Retry Policy | ✅ IMPLEMENTED | ❌ NO |
| 9 | activity_id Format | ❓ PARTIAL | ❌ NO — may need to adjust |
| 10 | Energy Webhook URL | ⚠️ UNVERIFIED | ❌ NO — existing, just needs regression check |
| 11 | Main Station Login URL | ⚠️ UNVERIFIED | ❌ NO — existing, just needs regression check |

---

## Blocking Summary

**CANNOT deploy badge integration until items 1 and 2 are received.**

That is **TWO URLs** — the only remaining customer dependencies.

---

## Customer Message Template (Updated 2026-09-11 22:57 UTC+8)

```
您好，

我们在准备勋章接口的预生产集成测试，需要确认最后两个信息即可完成部署：

1. Badge Detail 接口完整 URL
   路径已在规格文档中提供（/webhook/activity/badge/detail），
   请提供完整的 HTTPS 地址，例如 https://pre.xxx.com/webhook/activity/badge/detail

2. Badge Grant 接口完整 URL
   同上，路径 /webhook/activity/badge/grant，
   请提供完整 HTTPS 地址，例如 https://pre.xxx.com/webhook/activity/badge/grant

我们的服务器 IP（98.93.252.250）已告知，密钥沿用现有 WEBHOOK_SECRET。

收到这两个 URL 后，我们将立即部署并完成验证。

谢谢。
```

---
