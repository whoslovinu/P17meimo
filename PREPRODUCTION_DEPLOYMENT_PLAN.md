# PREPRODUCTION_DEPLOYMENT_PLAN.md

> Generated: 2026-09-11
> Updated: 2026-09-11 (Deployment Standby Mode — server `98.93.252.250`)
> Based on: `第三方活动勋章接口.md` (customer spec)
> Scope: Phase A badge ownership migration + pre-production integration

---

## 1. Deployment Overview

| Item | Value |
|---|---|
| Application | Repark H5 (Next.js) |
| Production host | `98.93.252.250` (EC2) |
| App directory on host | `/var/www/app` |
| Process manager | PM2 (`ecosystem.config.js`) |
| App port | 3000 (loopback only — nginx front, port 80 public) |
| Reverse proxy | nginx (`/etc/nginx/sites-enabled/repark`, see `scripts/nginx-repark.conf`) |
| Git branch | current |
| Migration | P1-77 Badge Phase A (Main Station badge metadata) |
| Standby trigger | Receipt of `MAIN_STATION_BADGE_DETAIL_URL` + `MAIN_STATION_BADGE_GRANT_URL` |

---

## 2. Build

```bash
# 1. TypeScript check
cd /var/www/app
npx tsc --noEmit
# Expected: 0 errors

# 2. Production build
npm run build
# Output: .next/ directory

# 3. Package
tar -czf /tmp/deploy.tar.gz .next/ package.json package-lock.json
```

**Build dependencies:**
- `lib/services/badgeAdapter.ts` — HMAC client for badge Detail + Grant (already implemented)
- `app/api/admin/badge/preview/route.ts` — NEW: thin proxy to `getBadgeDetail()` (Phase A)
- `app/admin/activities/[id]/config/page.tsx` — MilestoneCard updated to use preview route

---

## 3. Production Environment Variables

### 3.1 Required — Block Deploy If Missing

| Variable | Status | Notes |
|---|---|---|
| `MAIN_STATION_BADGE_DETAIL_URL` | ❌ MISSING | Full URL. E.g. `https://pre.xxx.com/webhook/activity/badge/detail` |
| `MAIN_STATION_BADGE_GRANT_URL` | ❌ MISSING | Full URL. E.g. `https://pre.xxx.com/webhook/activity/badge/grant` |
| `WEBHOOK_SECRET` | ⚠️ UNVERIFIED | HMAC shared secret. Must match customer's value. Must be ≥ 32 chars. |
| `REDIS_URL` | ✅ Known | `rp1-bkmbmc.serverless.use1.cache.amazonaws.com:6379` |
| `DATABASE_URL` | ✅ Known | AWS RDS — via SSH tunnel in dev; direct endpoint on host |
| `NEXT_PUBLIC_APP_URL` | ✅ Known | Production domain URL |
| `NEXT_PUBLIC_AUTH_COOKIE_NAME` | ✅ Known | Default: `uid` |
| `NEXT_PUBLIC_MAIN_STATION_URL` | ✅ Known | Customer's Main Station login URL |

### 3.2 PM2 Env Loading

`ecosystem.config.js` loads env vars from `/etc/repark/owner.env` at PM2 startup. The new badge env vars must be added there:

```bash
# /etc/repark/owner.env
MAIN_STATION_BADGE_DETAIL_URL=https://<customer-host>/webhook/activity/badge/detail
MAIN_STATION_BADGE_GRANT_URL=https://<customer-host>/webhook/activity/badge/grant
WEBHOOK_SECRET=<shared-32+-char-secret>
# ... existing vars
```

**⚠️ Block deploy if `MAIN_STATION_BADGE_DETAIL_URL` or `MAIN_STATION_BADGE_GRANT_URL` is not set.** `BadgeAdapter` throws `CONFIG_ERROR` on module load — the Next.js server will refuse to start.

---

## 4. Deployment Steps

### Step 1 — Pre-flight check (local)

```bash
npx tsc --noEmit
# Must exit 0 before proceeding
```

### Step 2 — Build + package

```bash
npm run build
tar -czf /tmp/deploy.tar.gz .next/ package.json package-lock.json
```

### Step 3 — Upload + extract on host

```bash
# From local terminal (adjust path):
scp /tmp/deploy.tar.gz ec2-user@<host>:/tmp/

# On host:
cd /var/www/app
sudo tar -xzf /tmp/deploy.tar.gz
ls .next/BUILD_ID   # confirm extraction
```

### Step 4 — Update env vars (on host)

```bash
# Add to /etc/repark/owner.env:
sudo nano /etc/repark/owner.env
# Add MAIN_STATION_BADGE_DETAIL_URL and MAIN_STATION_BADGE_GRANT_URL

# Validate syntax:
source /etc/repark/owner.env
echo $MAIN_STATION_BADGE_DETAIL_URL   # must print URL
```

### Step 5 — Rolling restart (zero-downtime preferred)

```bash
# Option A: pm2 reload (preferred — zero downtime)
pm2 reload repark-h5

# Option B: pm2 restart (if reload unavailable)
pm2 restart repark-h5
```

### Step 6 — Health check

```bash
# Wait for PM2 ready signal
pm2 logs repark-h5 --lines 20 --nostream

# HTTP health check
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/

# Expected: 200

# Badge preview smoke test (after customer provides URLs)
curl -s -X GET "http://localhost:3000/api/admin/badge/preview?badge_id=10021" \
  -H "Cookie: admin_token=<valid-token>" \
  -w "\n%{http_code}\n"

# Expected: HTTP 200 + {"ok":true,"data":{"badge_id":"10021","name":"...","icon":"...","description":"..."}}
```

---

## 5. Reverse Proxy (nginx)

If nginx is in front of Next.js (check `sudo ss -tlpn | grep ':80'` or `sudo ss -tlpn | grep ':443'`):

```bash
sudo nginx -t
# Expected: syntax is OK

# Reload if config changed:
sudo systemctl reload nginx
```

**Required nginx configuration:**
- No special badge-related headers needed (internal call from server to Main Station)
- Ensure outbound HTTPS from EC2 to Main Station's host is allowed (check SG outbound rules)

---

## 6. PM2 Process Manager

| Command | Action |
|---|---|
| `pm2 status` | Check running state |
| `pm2 logs repark-h5 --lines 50` | View recent logs |
| `pm2 monit` | Real-time CPU/memory monitor |
| `pm2 describe repark-h5` | Full process metadata |

**Rollback if deploy fails:**

```bash
# Identify previous build ID
ls /var/www/app/.next/BUILD_ID

# If bad: kill + restore previous tar
pm2 kill
cd /var/www/app
sudo tar -xzf /tmp/deploy.tar.gz   # restore previous
pm2 start ecosystem.config.js
pm2 save
```

---

## 7. Rollback Plan

### Trigger conditions for rollback
- `curl http://localhost:3000/` returns non-200
- PM2 `repark-h5` status is `errored` or `stopped`
- Badge preview returns 500 for a valid badge_id

### Rollback procedure

```bash
# 1. Restore previous build
cd /var/www/app
sudo tar -xzf /tmp/deploy-prev.tar.gz  # if available

# Or: git checkout + rebuild
git checkout HEAD~1
npm run build
tar -czf /tmp/deploy-rollback.tar.gz .next/
sudo tar -xzf /tmp/deploy-rollback.tar.gz

# 2. Restart
pm2 restart repark-h5
sleep 10
pm2 status

# 3. Verify
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
# Must be 200
```

### Previous build preservation

Before every deploy, archive the current build:
```bash
sudo cp -r /var/www/app/.next /tmp/.next-pre-badge-migration
sudo tar -czf /tmp/deploy-pre-badge-migration.tar.gz /var/www/app/.next
echo "Archived: $(date)"
```

---

## 8. Deployment Checklist

- [ ] `npx tsc --noEmit` → 0 errors
- [ ] `npm run build` → completes without error
- [ ] `MAIN_STATION_BADGE_DETAIL_URL` set in `/etc/repark/owner.env`
- [ ] `MAIN_STATION_BADGE_GRANT_URL` set in `/etc/repark/owner.env`
- [ ] `WEBHOOK_SECRET` confirmed with customer
- [ ] `pm2 reload repark-h5` → status `online`
- [ ] `curl localhost:3000/` → 200
- [ ] Badge preview smoke test → 200 + valid JSON
- [ ] Admin milestone form loads → no console errors
- [ ] nginx syntax OK + reloaded (if applicable)
- [ ] PM2 saved: `pm2 save`

---

## 10. Standby → Trigger Execution Sequence

This sequence runs **immediately and atomically** once the customer provides the two URLs.

### Pre-condition gate (must hold before any step)

```bash
# Confirm URLs are present in /etc/repark/owner.env
source /etc/repark/owner.env
test -n "$MAIN_STATION_BADGE_DETAIL_URL" || { echo "FAIL: missing DETAIL URL"; exit 1; }
test -n "$MAIN_STATION_BADGE_GRANT_URL"   || { echo "FAIL: missing GRANT URL";  exit 1; }
echo "Both URLs present. Proceeding."
```

### Execution sequence (10 steps)

```bash
# === STEP 1: Update .env.production (or /etc/repark/owner.env) ===
sudo tee -a /etc/repark/owner.env >/dev/null <<EOF
MAIN_STATION_BADGE_DETAIL_URL=<provided-url>
MAIN_STATION_BADGE_GRANT_URL=<provided-url>
EOF
sudo chmod 600 /etc/repark/owner.env
```

```bash
# === STEP 2: Build production locally ===
cd <local-project-root>
npx tsc --noEmit                                  # 0 errors required
npm run build                                      # .next/ produced
tar -czf /tmp/deploy-badge-migration.tar.gz .next/ package.json package-lock.json
```

```bash
# === STEP 3: Upload + extract on 98.93.252.250 ===
scp /tmp/deploy-badge-migration.tar.gz ubuntu@98.93.252.250:/tmp/

ssh ubuntu@98.93.252.250 <<'EOF'
  cd /var/www/app
  sudo tar -xzf /tmp/deploy-badge-migration.tar.gz
  ls -la .next/BUILD_ID
EOF
```

```bash
# === STEP 4: Restart PM2 (preserves env via /etc/repark/owner.env) ===
ssh ubuntu@98.93.252.250 "pm2 reload repark-h5"
ssh ubuntu@98.93.252.250 "sleep 8 && pm2 status"
# Expect: repark-h5 status=online, no `errored`
```

```bash
# === STEP 5: Health check (nginx → Next.js) ===
ssh ubuntu@98.93.252.250 "curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/"
# Expect: 200

ssh ubuntu@98.93.252.250 "curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/_nginx_health"
# Expect: 200 (nginx upstream-isolated health)
```

```bash
# === STEP 6: Badge Preview API verification ===
# First, get a valid admin cookie. The integration test harness (Step 6b) will
# exercise the full flow. Manual smoke check:
ssh ubuntu@98.93.252.250 <<'EOF'
  TOKEN=$(curl -s -c - -X POST http://127.0.0.1:3000/api/admin/login \
    -H 'Content-Type: application/json' \
    -d '{"password":"<admin-pwd>"}' | grep admin_token | awk '{print $7}')
  curl -s "http://127.0.0.1:3000/api/admin/badge/preview?badge_id=10021" \
    -H "Cookie: admin_token=$TOKEN"
EOF
# Expect: {"ok":true,"data":{"badge_id":"10021","name":"...","icon":"...","description":"...","status":1}}
```

```bash
# === STEP 7: Badge Grant API verification ===
# Use a known test user_id + activity_id from staging config.
ssh ubuntu@98.93.252.250 <<'EOF'
  # Triggered by /api/battle/reward-claim, not a direct call.
  # See Step 8 for end-to-end test.
  echo "Grant is exercised via reward-claim flow in Step 8"
EOF
```

```bash
# === STEP 8: Milestone reward flow (end-to-end) ===
# Hit /api/battle/reward-claim with a MEDAL-type milestone. The route
# internally calls grantBadge → MAIN_STATION_BADGE_GRANT_URL.
# Use a known test user + a milestone with rewardType=MEDAL and valid medalId.
ssh ubuntu@98.93.252.250 <<'EOF'
  curl -s -X POST http://127.0.0.1:3000/api/battle/reward-claim \
    -H 'Content-Type: application/json' \
    -H 'Cookie: uid=<test-user-id>' \
    -d '{"milestone_id":"<test-medal-milestone-id>"}'
EOF
# Expect: {"ok":true,"data":{"milestone_id":"...","claimed":true,...}}
```

```bash
# === STEP 9: Regression checks ===
# 9a. ENERGY regression — trigger a milestone with rewardType=ENERGY
ssh ubuntu@98.93.252.250 <<'EOF'
  curl -s -X POST http://127.0.0.1:3000/api/battle/reward-claim \
    -H 'Content-Type: application/json' \
    -H 'Cookie: uid=<test-user-id>' \
    -d '{"milestone_id":"<test-energy-milestone-id>"}'
EOF
# Expect: {"ok":true,...} and outbound call to MAIN_STATION_ADD_ENERGY_URL succeeds

# 9b. Battle regression — /api/battle/init must return milestones unchanged
ssh ubuntu@98.93.252.250 <<'EOF'
  curl -s "http://127.0.0.1:3000/api/battle/init" -H 'Cookie: uid=<test-user-id>'
EOF
# Expect: 200, milestones array unchanged

# 9c. Admin regression — load /admin/activities/<id>/config page
ssh ubuntu@98.93.252.250 "curl -s -o /dev/null -w '%{http_code}\n' \
  http://127.0.0.1:3000/admin/activities/1/config"
# Expect: 200

# 9d. Redis — pm2 logs must show no badge-related Redis errors
ssh ubuntu@98.93.252.250 "pm2 logs repark-h5 --lines 100 --nostream | grep -i 'badge\|redis' | tail -20"
```

```bash
# === STEP 10: Generate PREPRODUCTION_VERIFICATION_REPORT.md ===
# Run the integration test suite (tests/api/) and capture results.
ssh ubuntu@98.93.252.250 "cd /var/www/app && npm run test:integration 2>&1 | tee /tmp/integration-test-out.txt"

# Locally:
cat > PREPRODUCTION_VERIFICATION_REPORT.md <<EOF
# PREPRODUCTION VERIFICATION REPORT
Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Host: 98.93.252.250

## Badge Preview
- Status: $(grep 'badge preview' /tmp/integration-test-out.txt | head -1)

## Badge Grant
- Status: $(grep 'badge grant' /tmp/integration-test-out.txt | head -1)

## ENERGY regression
- Status: $(grep 'energy' /tmp/integration-test-out.txt | head -1)

## Battle regression
- Status: $(grep 'battle init' /tmp/integration-test-out.txt | head -1)

## Admin
- Status: $(grep 'admin config' /tmp/integration-test-out.txt | head -1)

## Rollback verification
- Archived build: $(ls -la /tmp/deploy-pre-badge-migration.tar.gz | awk '{print $5,$9}')
EOF
```

### Rollback trigger (if any step fails)

```bash
ssh ubuntu@98.93.252.250 <<'EOF'
  pm2 kill
  cd /var/www/app
  sudo tar -xzf /tmp/deploy-pre-badge-migration.tar.gz
  pm2 start ecosystem.config.js
  pm2 save
  sleep 8
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
EOF
# Then escalate to Commander with the failed step number.
```

---

## 11. Standby Mode — Do Not Deploy Until Trigger

**Status: STANDBY**

Deployment will NOT execute until BOTH URLs are received:

- `MAIN_STATION_BADGE_DETAIL_URL`
- `MAIN_STATION_BADGE_GRANT_URL`

When received: execute §10 above immediately.
