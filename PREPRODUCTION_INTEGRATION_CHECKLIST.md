# PREPRODUCTION_INTEGRATION_CHECKLIST.md

> Generated: 2026-09-11
> Scope: Pre-production integration verification for P1-77 badge ownership migration

---

## 1. Badge Preview (Milestone Config Form)

| # | Check | Method | Pass Criteria | Status |
|---|---|---|---|---|
| 1.1 | Badge preview route exists | `GET /api/admin/badge/preview?badge_id=10021` | HTTP 200, valid JSON | ⬜ |
| 1.2 | Main Station reachable | Same request | No timeout, no ECONNREFUSED | ⬜ |
| 1.3 | Valid badge returns name | Parse response | `data.name` is non-empty string | ⬜ |
| 1.4 | Valid badge returns icon | Parse response | `data.icon` is URL string or `""` | ⬜ |
| 1.5 | Valid badge returns description | Parse response | `data.description` is string | ⬜ |
| 1.6 | Valid badge returns badge_id | Parse response | `data.badge_id` matches input | ⬜ |
| 1.7 | Invalid badge_id returns 200 | `GET /api/admin/badge/preview?badge_id=99999` | HTTP 200, `ok: false`, `reason: "NOT_FOUND"` | ⬜ |
| 1.8 | Missing badge_id returns 400 | `GET /api/admin/badge/preview` (no param) | HTTP 400, `reason: "INVALID_PARAM"` | ⬜ |
| 1.9 | HMAC signed correctly | Check Main Station logs | No "签名验证失败" error | ⬜ |
| 1.10 | Debounce works in UI | Type medalId in form | No request until 500ms after keystroke | ⬜ |
| 1.11 | "Not found" banner shown | Enter invalid ID | Red banner with "勋章不存在或 Main Station 无法访问" | ⬜ |
| 1.12 | Loading spinner shown | Debounce period | Spinner visible during fetch | ⬜ |
| 1.13 | Preview hidden when ENERGY | Select ENERGY reward type | No badge preview section visible | ⬜ |
| 1.14 | Preview shown when MEDAL | Select MEDAL reward type | Badge preview section visible | ⬜ |
| 1.15 | No local badges table called | Code review | `adminFetch('/api/admin/badge/preview')` — no `GET /api/admin/badge/[id]` | ⬜ |

---

## 2. Badge Grant (Reward Claim)

| # | Check | Method | Pass Criteria | Status |
|---|---|---|---|---|
| 2.1 | grantBadge function exists | Code review | `lib/services/badgeAdapter.ts` exports `grantBadge()` | ⬜ |
| 2.2 | reward-claim calls grantBadge | Code review | `app/api/battle/reward-claim/route.ts` calls `grantBadge()` for MEDAL rewards | ⬜ |
| 2.3 | medalId used as badgeId | Code review | `milestoneConfig?.medalId` passed directly, not queried from local DB | ⬜ |
| 2.4 | request_id generated | Code review | Stable `request_id` generated and reused across retries | ⬜ |
| 2.5 | HMAC header attached | Code review | `X-Webhook-Signature: sha256=<hex>` set | ⬜ |
| 2.6 | Content-Type set | Code review | `Content-Type: application/json; charset=utf-8` | ⬜ |
| 2.7 | Retry logic present | Code review | `MAX_RETRIES=3`, retry on network error | ⬜ |
| 2.8 | Idempotent grant (API) | Customer spec | Duplicate grant for same user+badge returns `code: 200` | ⬜ |
| 2.9 | Config error on missing medalId | Code review | Missing `medalId` returns `CONFIG_ERROR` 500 | ⬜ |
| 2.10 | Graceful degradation | Code review | If grant fails → error logged, not thrown to client | ⬜ |

---

## 3. Energy Reward (Baseline — Unchanged)

| # | Check | Method | Pass Criteria | Status |
|---|---|---|---|---|
| 3.1 | Energy reward flow unchanged | Code review | `reward-claim` energy branch unchanged | ⬜ |
| 3.2 | Energy webhook URL | Code review | `MAIN_STATION_ADD_ENERGY_URL` still referenced | ⬜ |
| 3.3 | Energy HMAC signing | Code review | Same `signWebhookPayload()` as badge | ⬜ |

---

## 4. Battle Flow (Baseline — Unchanged)

| # | Check | Method | Pass Criteria | Status |
|---|---|---|---|---|
| 4.1 | battleInit returns milestones | `GET /api/game/battleInit` | `config.milestones[].medalId` present | ⬜ |
| 4.2 | SubPageModal displays milestone | Code review | `reward.rewardType === 'MEDAL'` branch displays 🏅 | ⬜ |
| 4.3 | MilestoneBar displays MEDAL reward | Code review | `rewardType === 'MEDAL'` branch renders | ⬜ |
| 4.4 | No local badges query in battle flow | Code review | Battle routes do not import badge pg functions | ⬜ |

---

## 5. Redis

| # | Check | Method | Pass Criteria | Status |
|---|---|---|---|---|
| 5.1 | Redis reachable | `pm2 logs` or `redis-cli ping` | `PONG` | ⬜ |
| 5.2 | Battle state keys exist | `redis-cli KEYS battle:*` | At least `battle:state` key | ⬜ |
| 5.3 | Redis health in monitor | `GET /api/admin/monitor` | `redis: ok: true` | ⬜ |
| 5.4 | No badge data in Redis | Code review | No `badge:*` keys in Redis | ⬜ |

---

## 6. Authentication

| # | Check | Method | Pass Criteria | Status |
|---|---|---|---|---|
| 6.1 | Admin login works | `POST /api/admin/login` | Returns cookie, no 401 | ⬜ |
| 6.2 | Badge preview requires auth | `GET /api/admin/badge/preview` without cookie | HTTP 401 | ⬜ |
| 6.3 | Badge preview accessible with auth | With valid admin cookie | HTTP 200 | ⬜ |
| 6.4 | H5 client auth unchanged | `GET /api/game/battleInit` with cookie | HTTP 200 | ⬜ |
| 6.5 | Middleware guards `/api/admin/*` | Code review | Iron Gate HMAC auth on all admin routes | ⬜ |

---

## 7. Webhook Security

| # | Check | Method | Pass Criteria | Status |
|---|---|---|---|---|
| 7.1 | WEBHOOK_SECRET ≥ 32 chars | `echo $WEBHOOK_SECRET \| wc -c` | ≥ 33 (32 + newline) | ⬜ |
| 7.2 | Badge adapter imports HMAC from lib | Code review | `signWebhookPayload()` from `verifyWebhookSignature.ts` | ⬜ |
| 7.3 | HMAC uses raw UTF-8 bytes | Code review | `body` is raw JSON string, not parsed+re-serialized | ⬜ |
| 7.4 | Same secret for Detail + Grant | Code review | Both calls use `getWebhookSecret()` | ⬜ |
| 7.5 | No secret hardcoded | Code review | No raw secret strings in source files | ⬜ |

---

## 8. Admin UI

| # | Check | Method | Pass Criteria | Status |
|---|---|---|---|---|
| 8.1 | Badge nav entry removed | UI inspection | No 勋章管理 in sidebar | ⬜ |
| 8.2 | Badge dashboard shortcut removed | UI inspection | No 勋章管理 card in quick entry | ⬜ |
| 8.3 | Activity config form loads | `GET /admin/activities/1/config` | Page renders without error | ⬜ |
| 8.4 | Milestone section accessible | UI | Section renders, no 404 | ⬜ |
| 8.5 | CRUD pages still exist at URL (rollb | `GET /admin/badges` | HTTP 200 (nav removed, page preserved) | ⬜ |
| 8.6 | No broken import on removed pages | `pm2 logs` | No `Module not found` for badge pages | ⬜ |

---

## 9. Activity Configuration

| # | Check | Method | Pass Criteria | Status |
|---|---|---|---|---|
| 9.1 | medalId field still present | UI | MEDAL reward type shows medalId input | ⬜ |
| 9.2 | Only medalId stored (not metadata) | Save + reload activity | `config.milestones[].medalId` is plain string | ⬜ |
| 9.3 | Multiple milestones saved correctly | Save activity with 3 milestones | All 3 milestones in DB with correct medalIds | ⬜ |
| 9.4 | badgeId debounce: no spam on save | UI | No excessive requests while typing | ⬜ |
| 9.5 | Form save does NOT call badge preview | Network tab | Preview fetch stops on save, not triggered by save | ⬜ |

---

## 10. Rollback Verification

| # | Check | Method | Pass Criteria | Status |
|---|---|---|---|---|
| 10.1 | Previous build archived | `ls /tmp/deploy-pre-badge-migration.tar.gz` | File exists | ⬜ |
| 10.2 | Rollback restores previous state | Git `git status` shows badge CRUD pages unchanged | CRUD pages still compile | ⬜ |
| 10.3 | PM2 saves state | `pm2 save` after deploy | `.pm2/dump.pm2` updated | ⬜ |
| 10.4 | Rollback procedure documented | `PREPRODUCTION_DEPLOYMENT_PLAN.md` §7 | Rollback steps documented | ⬜ |
| 10.5 | No irreversible DB changes this phase | Schema review | No migration SQL run this phase | ⬜ |

---

## Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Engineer | | 2026-09-11 | |
| Commander | | 2026-09-11 | |

> All items must be ✅ before signing off on pre-production release.
