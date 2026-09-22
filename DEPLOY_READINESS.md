# 🚀 DEPLOYMENT READINESS REPORT — P17 H5
**Generated**: 2026-07-11 (after goutong.md intake)
**Customer-facing URL**: `http://98.93.252.250:3000`

---

## ✅ READINESS SCORECARD

| Dimension | Status | Notes |
|---|---|---|
| **Code (功能完整性)** | ✅ ALL FEATURES DONE | Spine 4.1 + Audio + Leaderboard + 4-stage morph + Cookie + Webhook |
| **Spine animation assets** | ✅ DELIVERED | Customer handed over all 4 stages |
| **AWS EC2 server** | ✅ READY | ubuntu@98.93.252.250:22 (SSH key auth) |
| **AWS RDS (PostgreSQL)** | ✅ READY | rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com:5432 |
| **AWS ElastiCache (Redis)** | ✅ READY | rp1-bkmbmc.serverless.use1.cache.amazonaws.com:6379 (no password, TLS) |
| **Security group 80/443** | ✅ OPEN | Per goutong.md:239 |
| **Webhook endpoint** | ✅ CODE READY | `/api/webhook/user-action` waits for customer to push |
| **Cookie auth key name** | ⚠️ NEEDS CONFIRM | Defaulted to `uid` — customer should confirm |
| **Customer-side integration test** | ❌ PENDING | Customer needs to push test webhook + provide 2-3 test accounts |

---

## 🔌 Connection Details (from goutong.md:228-301)

| Service | Endpoint | Auth |
|---|---|---|
| **App server (SSH)** | `ubuntu@98.93.252.250:22` | ed25519 public key (already added by customer) |
| **PostgreSQL** | `rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com:5432` | `postgres` / `PhbcRcx5Wt` |
| **Redis** | `rp1-bkmbmc.serverless.use1.cache.amazonaws.com:6379` | No password (TLS required) |
| **Webhook receive** | `POST http://98.93.252.250/api/webhook/user-action` | HMAC-SHA256 with WEBHOOK_SECRET |
| **Cookie** | name=`uid` (assumed) — **customer must confirm** | value = authenticated user_id |

---

## 🚀 DEPLOY COMMAND (with VPN connected)

```powershell
# 1. Generate .env.production locally (interactive prompts)
node scripts/mint-env-production.mjs
#    ↳ Press Enter to accept all defaults (pre-filled from goutong.md)

# 2. SCP env to server
scp .env.production ubuntu@98.93.252.250:/var/www/app/.env.production
ssh ubuntu@98.93.252.250 "chmod 600 /var/www/app/.env.production"

# 3. ONE-COMMAND DEPLOY + ACCEPTANCE TEST
node scripts/deploy-to-customer.mjs
#    ↳ Packages code → SCP to server → server-provision → server-first-deploy → server-acceptance-test
#    ↳ Prints PASS/FAIL per check
```

---

## ✅ CUSTOMER ACCEPTANCE CHECKLIST (from goutong.md + code)

The `scripts/server-acceptance-test.sh` runs these 8 checks automatically:

1. **HTTP reachable** on :3000
2. **`/api/internal/startup`** returns ok=true
3. **`/api/boss/status`** returns ok=true (full-server HP visible)
4. **`/api/battle/init`** works with dev test user
5. **`/api/action/attack`** succeeds 2/3 times (core game mechanic)
6. **`/battle` page** returns valid HTML (UI loads)
7. **Rate limit** triggers 429 under burst load (anti-cheat active)
8. **Latency bench** — p99 ≤ 8s under 50-sample attack load

---

## ⏳ POST-DEPLOY (customer-side integration)

After the deploy script prints "🎉 全部通过", customer needs to:

| # | Task | Why |
|---|---|---|
| 1 | Tell us the actual Cookie name (or confirm `uid`) | So user authentication works |
| 2 | Push 1 test webhook to `/api/webhook/user-action` | Verifies end-to-end game loop |
| 3 | Open URL in browser with their Cookie set | Verifies full UX |
| 4 | Provide 2-3 test accounts (with recharge history) | For full game flow test |

---

## 🔐 SECURITY CHECKLIST

- [x] Admin password → env (not hardcoded)
- [x] Webhook signature (HMAC-SHA256)
- [x] Owner command key (HMAC)
- [x] Redis TLS (production enforced)
- [x] PostgreSQL password in env only
- [x] `OWNER_COMMAND_KEY` rotated (goutong.md:289-290 — old key revoked)
- [ ] Nginx reverse proxy + HTTPS — pending (port 80/443 open but not configured yet)

---

## ⚠️ OPEN ITEMS (deferred — not blocking)

1. **Nginx HTTPS setup** — Currently the app listens on :3000 directly. Should add Nginx on :80/:443 with Let's Encrypt for customer-facing TLS.
2. **Audio assets** — Customer mentioned voice clips will come in 4 deliveries. First one not yet uploaded.
3. **Domain name** — Customer hasn't provided a domain. App currently accessible only via IP.
4. **14× `process.env.*` direct reads** (WARN only — not blocking deploy)
5. **Admin login route** error format inconsistency (WARN only — not blocking deploy)

---

## 🎯 RECOMMENDED NEXT STEPS (in order)

1. **Connect VPN**
2. **Run `node scripts/mint-env-production.mjs`** (5 min, all defaults pre-filled)
3. **Run `node scripts/deploy-to-customer.mjs`** (15 min, automated)
4. **Tell customer the URL works** — they need to:
   - Confirm cookie name
   - Push a test webhook
   - Test in their main station's WebView

That's it. No code changes needed. No tsc required. No docker required.
