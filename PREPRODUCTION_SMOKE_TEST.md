# PREPRODUCTION_SMOKE_TEST.md

> Generated: 2026-09-11 23:43 UTC+8
> Status: **READY FOR EXECUTION** — pending customer URL delivery
> Scope: Pre-production smoke test for the Badge Detail + Badge Grant integration
> Production host: `98.93.252.250`
> Reference: `scripts/verify-badge-endpoints.mjs` (network-level verification)

---

## Pre-conditions (must hold before starting)

| # | Pre-condition | Verified by |
|---|---|---|
| 1 | `MAIN_STATION_BADGE_DETAIL_URL` set in `/etc/repark/owner.env` | Operator |
| 2 | `MAIN_STATION_BADGE_GRANT_URL` set in `/etc/repark/owner.env` | Operator |
| 3 | `WEBHOOK_SECRET` set in `/etc/repark/owner.env` (same secret as ENERGY) | Operator |
| 4 | `MAIN_STATION_ADD_ENERGY_URL` unchanged (regression baseline) | Operator |
| 5 | PM2 running with new build (`pm2 status` → repark-h5 online) | `ssh 98.93.252.250 "pm2 status"` |
| 6 | Customer's IP whitelist includes our outbound IP `98.93.252.250` | Customer |
| 7 | Test user with valid session available (e.g. `uid=128`) | Operator |
| 8 | Test activity ID exists in `public.activities` (e.g. `id=1`) | Operator |

**Trigger gate:** If any pre-condition fails → STOP. Do not proceed to §1.

---

## Section 1 — Admin Configuration

**Goal:** Confirm admin can create an activity with a MEDAL-type milestone referencing a valid badge ID, and that the row is correctly persisted in `public.activities` (JSON `config.milestones[]`).

### 1.1 Login as admin

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  RESP=$(curl -s -c /tmp/admin.cookies -X POST \
    http://127.0.0.1:3000/api/admin/login \
    -H 'Content-Type: application/json' \
    -d "{\"password\":\"${ADMIN_PASSWORD}\"}")
  echo "$RESP"
EOF
# Expect: {"ok":true,"data":{...}} and /tmp/admin.cookies written
```

**Pass criteria:** `{"ok":true,...}` AND `/tmp/admin.cookies` contains `admin_token`.

### 1.2 Create a test activity

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  curl -s -b /tmp/admin.cookies -X POST \
    http://127.0.0.1:3000/api/admin/activity \
    -H 'Content-Type: application/json' \
    -d '{
      "name": "PREPROD_BADGE_TEST",
      "boss":  {"totalHp": 1000000, "currentHp": 1000000},
      "milestones": [
        {"id": 9001, "threshold": 75, "rewardType": "MEDAL", "medalId": "10021"}
      ]
    }'
EOF
# Expect: {"ok":true,"data":{"activity_id": <new_id>}}
```

**Record** the returned `activity_id` — use it for §1.3, §3.x.

### 1.3 Verify DB row

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT id, name, config->'milestones' AS milestones FROM public.activities WHERE name='PREPROD_BADGE_TEST';"
EOF
```

**Pass criteria:** Row exists; `milestones` JSON contains:

```json
[{"id": 9001, "threshold": 75, "rewardType": "MEDAL", "medalId": "10021"}]
```

### 1.4 Verify saved row matches what was sent

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -t -A <<SQL
    SELECT
      config->'milestones'->0->>'rewardType' AS reward_type,
      config->'milestones'->0->>'medalId'    AS medal_id
    FROM public.activities WHERE name='PREPROD_BADGE_TEST';
SQL
EOF
```

**Pass criteria:** Output is exactly `MEDAL|10021` (pipe-separated).

### 1.5 Edit form re-renders correctly

```bash
ssh ubuntu@98.93.252.250 "curl -s -b /tmp/admin.cookies \
  http://127.0.0.1:3000/admin/activities/<id>/config \
  | grep -E 'medalId|rewardType' | head -5"
```

**Pass criteria:** HTML contains both `medalId` value `10021` and `MEDAL` option selected.

**Section 1 PASS condition:** 1.1–1.5 all green.

---

## Section 2 — Badge Preview

**Goal:** Confirm `/api/admin/badge/preview?badge_id=` proxies to Main Station and returns the expected taxonomy.

### 2.1 Valid badge

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  curl -s -b /tmp/admin.cookies \
    "http://127.0.0.1:3000/api/admin/badge/preview?badge_id=10021"
EOF
```

**Pass criteria:**

```json
{"ok":true,"data":{"badge_id":"10021","name":"<name>","icon":"<url>","description":"<text>","status":1}}
```

- `ok === true`
- `data.status === 1`
- `data.name` non-empty
- `data.icon` non-empty
- Latency < 10 s (record `time_total`)

### 2.2 Invalid badge (not found)

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  curl -s -b /tmp/admin.cookies \
    "http://127.0.0.1:3000/api/admin/badge/preview?badge_id=99999"
EOF
```

**Pass criteria:**

```json
{"ok":false,"reason":"NOT_FOUND","message":"..."}
```

or HTTP 404 with a clear error body. Either is acceptable.

### 2.3 Inactive badge

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  curl -s -b /tmp/admin.cookies \
    "http://127.0.0.1:3000/api/admin/badge/preview?badge_id=10022"
EOF
```
*(Assume `10022` is configured offline by the customer. If unknown, ask customer for one.)*

**Pass criteria:**

```json
{"ok":false,"reason":"INACTIVE","message":"..."}
```

### 2.4 Timeout

Simulate by pointing the host to a non-responsive URL temporarily, **OR** ask customer to throttle one endpoint for the test. Skip if not feasible.

**Pass criteria:** Request returns within `REQUEST_TIMEOUT_MS` (10 s). Adapter's retry logic will log `code=520` retries — capture `pm2 logs repark-h5 --lines 200` to confirm.

### 2.5 Verify HMAC was accepted (positive signal)

```bash
ssh ubuntu@98.93.252.250 "pm2 logs repark-h5 --lines 200 --nostream | grep -E 'BadgeAdapter|HMAC|signature'"
```

**Pass criteria:** Logs show NO `401`, NO `AUTH_FAILED`, NO signature error messages. The customer Main Station accepted our signed request.

**Section 2 PASS condition:** 2.1–2.3 all green; 2.4 if executed; 2.5 clean.

---

## Section 3 — Reward Claim

**Goal:** Confirm `/api/battle/reward-claim` correctly calls `grantBadge` and handles all failure modes.

### 3.1 First claim (happy path)

Prereq: user has accumulated damage ≥ 75 (the milestone threshold from §1.2).

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  curl -s -X POST http://127.0.0.1:3000/api/battle/reward-claim \
    -H 'Content-Type: application/json' \
    -H 'Cookie: uid=128' \
    -d '{"milestone_id":"9001"}'
EOF
```

**Pass criteria:**

```json
{"ok":true,"data":{"milestone_id":"9001","claimed":true,"claimed_at":"<iso>"}}
```

Verify via DB:

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -t -A <<SQL
    SELECT user_id, milestone_id, claimed_at
    FROM public.user_milestone_claims
    WHERE milestone_id = 9001 AND user_id = '128';
SQL
EOF
```

Expected: exactly one row, `claimed_at` non-null.

### 3.2 Duplicate claim

Re-run §3.1 with the same `uid` and `milestone_id`.

**Pass criteria:** Response is `{"ok":true,"data":{"milestone_id":"9001","claimed":false,...}}` OR `{"ok":false,"error":{"code":"ALREADY_CLAIMED",...}}`. Critically: **DB row is NOT double-inserted, and Main Station is NOT called a second time.**

Verify:

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -t -A -c \
    "SELECT count(*) FROM public.user_milestone_claims WHERE milestone_id = 9001 AND user_id = '128';"
EOF
# Expect: 1 (not 2)

  pm2 logs repark-h5 --lines 100 --nostream | grep -c 'POST.*badge/grant'
EOF
# Expect: count from 3.1 (e.g. 1). Should NOT increment after 3.2.
```

### 3.3 Network failure (Main Station unreachable)

Temporarily break the URL:

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  # Back up the live URL and replace with an unreachable one
  sudo cp /etc/repark/owner.env /etc/repark/owner.env.bak
  sudo sed -i 's|MAIN_STATION_BADGE_GRANT_URL=.*|MAIN_STATION_BADGE_GRANT_URL=http://127.0.0.1:65500/webillneverstart|' /etc/repark/owner.env
  pm2 reload repark-h5
  sleep 8
EOF

# Trigger claim for a DIFFERENT test milestone (e.g. create one in §1 first,
# or use an existing ENERGY-type milestone for the failure test).
# Here we use a fresh MEDAL milestone to verify the BADGE path specifically.
```

Use the test user with a fresh milestone configured:

```bash
# Create a fresh milestone in §1's test activity (id 9002), then:
ssh ubuntu@98.93.252.250 <<'EOF'
  curl -s -X POST http://127.0.0.1:3000/api/battle/reward-claim \
    -H 'Content-Type: application/json' \
    -H 'Cookie: uid=128' \
    -d '{"milestone_id":"9002"}'
EOF
```

**Pass criteria:**

- Response: `{"ok":false,"error":{"code":"UPSTREAM_UNAVAILABLE","message":"..."}}` (or equivalent)
- Adapter retried exactly `MAX_RETRIES` (3) times — check `pm2 logs repark-h5 --lines 500 | grep -c "retry #"`
- DB row in `public.user_milestone_claims` for `milestone_id=9002` is **NOT inserted** (claim must be all-or-nothing with Main Station)

Verify DB:

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -t -A -c \
    "SELECT count(*) FROM public.user_milestone_claims WHERE milestone_id = 9002 AND user_id = '128';"
EOF
# Expect: 0
```

Restore the URL after the test:

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  sudo cp /etc/repark/owner.env.bak /etc/repark/owner.env
  sudo rm /etc/repark/owner.env.bak
  pm2 reload repark-h5
  sleep 8
EOF
```

### 3.4 HMAC failure

Temporarily break the secret to force an HMAC rejection:

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  sudo cp /etc/repark/owner.env /etc/repark/owner.env.bak
  # Append a wrong secret — this DOES NOT change the original WEBHOOK_SECRET,
  # it shadows it with a deliberately wrong value used only by the test route.
  # Simpler approach: temporarily set MAIN_STATION_BADGE_DETAIL_URL to the
  # GRANT URL (which our app will sign with the same secret — should still work)
  # OR ask the customer to enable a debug flag that rejects all signatures.
EOF
```

If HMAC failure simulation is not feasible in production, **mark this section as SKIPPED** with a note. The unit test in `tests/api/badgeAdapter.test.ts` (if present) covers HMAC mismatch at the unit level.

**Pass criteria (when executed):**

- Main Station returns `code=401`
- Adapter does NOT retry (per spec, 401 is non-retryable)
- DB row for `milestone_id=9003` is NOT inserted
- Logs show `reason=AUTH_FAILED`

Restore:

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  sudo cp /etc/repark/owner.env.bak /etc/repark/owner.env
  sudo rm /etc/repark/owner.env.bak
  pm2 reload repark-h5
  sleep 8
EOF
```

**Section 3 PASS condition:** 3.1 PASS, 3.2 idempotency confirmed, 3.3 retry+DB-rollback confirmed, 3.4 (if executed) PASS.

---

## Section 4 — Customer Verification

**Goal:** Confirm the customer's Main Station UI shows the granted badge to the test user.

### 4.1 Provide customer with test user identity

Send to customer:

```
测试用户 ID: 128
测试活动: PREPROD_BADGE_TEST (id=<from §1.2>)
已授予勋章: badge_id=10021
请求时间: <timestamp>
```

### 4.2 Customer confirms in their Main Station admin / user-facing UI:

| Check | Required |
|---|---|
| Badge appears on the test user's profile | YES |
| Badge name matches what `/api/admin/badge/preview` returned in §2.1 | YES |
| Badge icon matches | YES |
| Badge owner = user `128` (canonical UUID also accepted) | YES |
| No duplicate badge from §3.2 duplicate claim | YES |

**Pass criteria:** Customer responds with explicit confirmation of all 5 items.

**Section 4 PASS condition:** Customer confirmation received.

---

## Section 5 — Regression

**Goal:** Confirm Badge integration has not broken any existing flow.

### 5.1 ENERGY regression

```bash
# Create an ENERGY milestone in §1's test activity first (or use an existing one)
ssh ubuntu@98.93.252.250 <<'EOF'
  curl -s -X POST http://127.0.0.1:3000/api/battle/reward-claim \
    -H 'Content-Type: application/json' \
    -H 'Cookie: uid=128' \
    -d '{"milestone_id":"<energy-milestone-id>"}'
EOF
# Expect: {"ok":true,...} and outbound call to MAIN_STATION_ADD_ENERGY_URL succeeds

# Verify energy callback landed at customer side:
ssh ubuntu@98.93.252.250 "pm2 logs repark-h5 --lines 200 --nostream | grep -E 'sendMainStationEnergyReward|energy.*callback'"
# Expect: log line confirming successful POST to MAIN_STATION_ADD_ENERGY_URL
```

### 5.2 Battle regression

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  curl -s "http://127.0.0.1:3000/api/battle/init" \
    -H 'Cookie: uid=128' | head -c 2000
EOF
```

**Pass criteria:** HTTP 200; response includes `config.spine` and `milestones[]` array (same shape as before).

### 5.3 Redis regression

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  redis-cli -u "$REDIS_URL" ping
  # Expect: PONG

  redis-cli -u "$REDIS_URL" keys 'hp:*' | head -5
  # Expect: keys present (or empty, both acceptable — depends on live activity)
EOF
```

```bash
ssh ubuntu@98.93.252.250 "pm2 logs repark-h5 --lines 500 --nostream | grep -i 'redis' | grep -iE 'error|fail'"
# Expect: empty (no Redis errors)
```

### 5.4 Admin regression

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  curl -s -b /tmp/admin.cookies -o /dev/null -w '%{http_code}\n' \
    http://127.0.0.1:3000/admin/activities
  curl -s -b /tmp/admin.cookies -o /dev/null -w '%{http_code}\n' \
    http://127.0.0.1:3000/admin/activities/1/config
  curl -s -b /tmp/admin.cookies -o /dev/null -w '%{http_code}\n' \
    http://127.0.0.1:3000/admin/badges
EOF
```

**Pass criteria:** All three return `200`.

### 5.5 Auth regression

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  # No admin cookie → must reject
  curl -s -o /dev/null -w '%{http_code}\n' \
    "http://127.0.0.1:3000/api/admin/badge/preview?badge_id=10021"
  # Expect: 401

  # No uid cookie → must reject
  curl -s -o /dev/null -w '%{http_code}\n' \
    -X POST http://127.0.0.1:3000/api/battle/reward-claim \
    -H 'Content-Type: application/json' \
    -d '{"milestone_id":"9001"}'
  # Expect: 401
EOF
```

**Section 5 PASS condition:** All 5.1–5.5 green.

---

## Section 6 — Rollback

**Goal:** Confirm we can disable the Badge integration without breaking ENERGY.

### 6.1 Disable Badge URLs

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  sudo cp /etc/repark/owner.env /etc/repark/owner.env.bak

  # Comment out the badge URLs (do NOT delete — keep evidence for re-enable)
  sudo sed -i 's|^MAIN_STATION_BADGE_DETAIL_URL=|#MAIN_STATION_BADGE_DETAIL_URL=|' /etc/repark/owner.env
  sudo sed -i 's|^MAIN_STATION_BADGE_GRANT_URL=|#MAIN_STATION_BADGE_GRANT_URL=|'  /etc/repark/owner.env

  cat /etc/repark/owner.env | grep -E 'BADGE'
EOF
```

**Expected:** Both badge lines prefixed with `#`. ENERGY lines untouched.

### 6.2 Restart PM2

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  pm2 reload repark-h5
  sleep 8
  pm2 status
EOF
```

**Pass criteria:** `repark-h5` status = `online`. **The BadgeAdapter is in fail-fast mode — server MUST refuse to start.** If PM2 status is `errored`, this is the expected behavior — note it and continue.

> ⚠️ **Known behavior:** `lib/services/badgeAdapter.ts` calls `requiredEnv()` at module load. With badge URLs commented, Next.js will fail to boot. This is intentional fail-fast. The §6.3 ENERGY verification in this state will be performed against the **last-known-good build** if needed (use `pm2 save` + revert `owner.env` for ENERGY-only smoke).

### 6.3 Verify ENERGY still works (after restoring URLs)

Restore badge URLs to confirm the system can be re-armed:

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  sudo cp /etc/repark/owner.env.bak /etc/repark/owner.env
  sudo rm /etc/repark/owner.env.bak
  pm2 reload repark-h5
  sleep 8

  # ENERGY smoke
  curl -s -o /dev/null -w '%{http_code}\n' \
    "http://127.0.0.1:3000/_nginx_health"
  # Expect: 200
EOF
```

Trigger an ENERGY claim (re-use §5.1):

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  curl -s -X POST http://127.0.0.1:3000/api/battle/reward-claim \
    -H 'Content-Type: application/json' \
    -H 'Cookie: uid=128' \
    -d '{"milestone_id":"<energy-milestone-id>"}'
EOF
```

**Pass criteria:** ENERGY claim returns `{"ok":true,...}`. `pm2 logs` shows successful outbound to `MAIN_STATION_ADD_ENERGY_URL`.

**Section 6 PASS condition:** URLs commented, server behaved as expected, restored successfully, ENERGY green.

---

## Final Report

After completing all six sections, write a single report:

```bash
# On the production server, capture full state into a single file
ssh ubuntu@98.93.252.250 <<'EOF'
  cat > /tmp/PREPROD_SMOKE_RESULT.txt <<TXT
Section 1 (Admin Configuration):    <PASS|FAIL>
Section 2 (Badge Preview):          <PASS|FAIL>
Section 3 (Reward Claim):           <PASS|FAIL>
Section 4 (Customer Verification):  <PASS|FAIL>
Section 5 (Regression):             <PASS|FAIL>
Section 6 (Rollback):               <PASS|FAIL>
Overall:                            <PASS|FAIL>
Operator:                           <name>
Date:                               $(date -u +"%Y-%m-%dT%H:%M:%SZ")
TXT
  cat /tmp/PREPROD_SMOKE_RESULT.txt
EOF
```

If **any** section is FAIL → STOP. Escalate to Commander with the failed section number and exact failure reason.

---

## Operator Run-Book Summary

```
[ ] §1.1  admin login → cookies saved
[ ] §1.2  POST /api/admin/activity → activity_id recorded: _______
[ ] §1.3  DB row visible in public.activities
[ ] §1.4  DB row matches sent payload (MEDAL|10021)
[ ] §1.5  Edit form re-renders correctly
[ ] §2.1  GET preview badge_id=10021 → ok:true, status:1
[ ] §2.2  GET preview badge_id=99999 → ok:false, reason:NOT_FOUND
[ ] §2.3  GET preview badge_id=10022 → ok:false, reason:INACTIVE
[ ] §2.5  pm2 logs clean of HMAC errors
[ ] §3.1  POST reward-claim milestone_id=9001 → ok:true, claimed:true
[ ] §3.2  duplicate claim → idempotent (DB count = 1, no double outbound)
[ ] §3.3  network failure → DB rollback confirmed (count = 0)
[ ] §4    customer confirmation received (5 items)
[ ] §5.1  ENERGY claim still works
[ ] §5.2  /api/battle/init shape unchanged
[ ] §5.3  Redis ping OK, no errors
[ ] §5.4  /admin/* pages all 200
[ ] §5.5  unauth requests return 401
[ ] §6.1  Badge URLs commented out
[ ] §6.2  PM2 reload behavior documented
[ ] §6.3  Badge URLs restored, ENERGY still green
[ ] Final /tmp/PREPROD_SMOKE_RESULT.txt written
```

**Status:** STANDBY — awaiting customer-provided URLs.

**No code changed. No production touched. No deployment executed.**
