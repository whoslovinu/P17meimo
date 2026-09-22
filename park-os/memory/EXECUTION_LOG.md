# REPARK v7.0 Execution Log

## Purpose
This file tracks what was built, when, and why.

## How to Use
- Add a new entry at the bottom after each sprint
- Include terminal proof (verification output)
- Reference related ADRs

## Entry Template

```markdown
## Sprint Log Entry
**Sprint**: [N]
**Date**: [YYYY-MM-DD]
**Mode**: [PROTOTYPE | PRODUCTION | ENTERPRISE]
**Duration**: [X hours]

### What We Built
[Brief description]

### Key Decisions
[Reference to ADR if applicable]

### Terminal Proof
```
[verification output]
```

### Metrics Impact
- Performance: [+/- X ms]
- Bundle: [+/- X KB]
- Test Coverage: [X%]

### Lessons Learned
[What we'd do differently]
```

## Sprint History

### Sprint 0: Phase 1 Structural Migration
**Date**: 2026-08-20
**Mode**: PRODUCTION (infrastructure)
**Duration**: ~15 minutes

#### What We Built
- Created park-os/ directory skeleton
- Archived brain/ to archive/v6/brain/ (preserved)
- Moved .cursorrules to project root
- Migrated ACTIVE_CONTEXT.md to park-os/memory/
- Created ARCHITECTURE_ADR.md (empty template)
- Created EXECUTION_LOG.md (empty template)
- Created CUSTOMER_MEMORY.md (empty template)
- Created .cursor/ignore for park-os isolation
- Updated 02-context-anchor.mdc path references

#### Terminal Proof
```
✓ Step 1: Directory skeleton created
✓ Step 2: brain/ archived to archive/v6/brain/
✓ Step 3: .cursorrules moved to root
✓ Step 4: ACTIVE_CONTEXT.md migrated
✓ Step 5: 3 new memory files created
✓ Step 6: .cursor/ignore created
✓ Step 7: Path references updated
```

#### Lessons Learned
[To be filled]

### Sprint N: Medal Grant + Badge Name (REPARK 7.0, 2026-09-13)
**Date**: 2026-09-13
**Mode**: PRODUCTION (hotfix, no schema / no spec change)
**Duration**: ~2 hours

#### What We Built
Fixed two customer-reported bugs in the H5 battle milestones flow. No schema, activity rules, or admin Badge CRUD touched. No real-user reward issued.

- `lib/badgeNameCache.ts` (new, ~270 lines): in-memory cache + de-dup + LRU + per-id budget race for Main Station `getBadgeDetail`. Fail-soft: never throws, never blocks init, never calls upstream for ENERGY milestones. TTL 5 min success / 30 s failure. Cap 64 entries.
- `app/api/game/milestone/claim/route.ts`: MEDAL branch now awaits `grantBadge()` BEFORE `upsertMilestoneReward`. Failure (NETWORK_ERROR / API_ERROR / AUTH_FAILED / NOT_FOUND / INACTIVE / INVALID_PARAM) returns 500 INTERNAL_ERROR and writes nothing. Missing medalId returns 500 CONFIG_ERROR. ENERGY branch unchanged (DB-first, fire-and-forget webhook).
- `app/api/battle/init/route.ts`: attaches `badgeName` to MEDAL milestones in the response payload. Each id has its own per-call race against `BADGE_NAME_TOTAL_BUDGET_MS=1500` so a slow upstream cannot stall the response. The whole `attachBadgeNames` call is wrapped in try/catch as defence in depth.
- `app/components/features/battle/SubPageModal.tsx`: `Reward` interface gains `badgeName: string | null`; defs pipeline passes it through unchanged. Render path: server name → fallback "勋章（ID：X）" → fallback "勋章". Applies to 待领取 + 已领取 both states.
- `vitest.config.ts` (new): minimal alias config so unit tests can use `@/...` imports.
- `tests/unit/badge-name-cache.spec.ts` (new): 9 cases — happy path, NOT_FOUND/INACTIVE, invalid id, ENERGY short-circuit, success cache, negative cache, per-id budget, parallel ids not serialised, in-flight de-dup.
- `tests/unit/milestone-claim-grant.spec.ts` (new): 5 cases — MEDAL success awaits grant before upsert; MEDAL failure writes no row; missing medalId → CONFIG_ERROR 500 no grant; ALREADY_CLAIMED idempotent no re-grant; ENERGY path unchanged.
- `tests/unit/badge-name-cache-timeout.spec.ts` (new): 5 cases — Promise.race does not abort the underlying getBadgeDetail (lookup completes in background and the cache absorbs it once it settles); cold cache with N MEDAL ids adds ≤1500 ms in PARALLEL on the first call; warm cache returns in <50 ms; per-id budget races an individual slow id and the others still resolve at 0 ms; cold-cache + 1 slow id completes in ~budget, not 3×budget.
- `tests/unit/subpage-modal-label.spec.ts` (new): 7 cases — direct mirror of the SubPageModal MEDAL ternary for 待领取/已领取 both states, plus an explicit assertion that the label is identical regardless of claimed flag.
- `tests/unit/subpage-modal-source.spec.ts` (new): 4 cases — static source-level verification that the SubPageModal.tsx ships the badgeName contract (interface field, defs pipeline pass-through, fallback chain in JSX, no hardcoded name tables).
- `tests/unit/subpage-modal-pipeline.spec.ts` (new): 6 cases — full init payload → defs → label resolution for the three documented branches; lock-set call-site count (exactly 2: OK branch and ALREADY_CLAIMED branch; THRESHOLD_NOT_MET and ACTIVITY_ENDED do NOT lock); THRESHOLD_NOT_MET/ACTIVITY_ENDED/INTERNAL_ERROR toast.error/warning paths.

**Total production change**: 4 files (3 modified + 1 new lib). Reason for exceeding the 3-file budget: the new `lib/badgeNameCache.ts` could NOT be folded into the existing `lib/services/badgeAdapter.ts` without expanding the adapter's surface area (which the brief explicitly forbade), and inlining the cache logic into `app/api/battle/init/route.ts` would have grown that route to ~700 lines and lost the per-id in-flight de-duplication that the cache provides. The standalone lib file is the smallest viable split.

#### Verification
- `npx tsc --noEmit` → PASS (no errors)
- `node node_modules/vitest/vitest.mjs run` → **36/36 PASS** across 6 spec files (badge-name-cache 9/9, badge-name-cache-timeout 5/5, milestone-claim-grant 5/5, subpage-modal-label 7/7, subpage-modal-source 4/4, subpage-modal-pipeline 6/6)
- `npm run build:no-lint` → PASS (`/api/game/milestone/claim` 275 B 103 kB in chunk list; new `lib/badgeNameCache.ts` rolled into the init route chunk)
- No real-Main-Station calls made; all tests mock `getBadgeDetail` and `grantBadge`.
- No production deploy executed. No real-user grant issued. No DB rows modified.

#### Actual cold-cache latency budget (corrected)
A cold cache adds up to **BADGE_NAME_TOTAL_BUDGET_MS = 1500 ms** of wall-clock latency on the FIRST init call only. Latency is bounded per-id, not per-call: N MEDAL ids cost the same as 1. Subsequent init calls (within the 5-minute success TTL or the 30-second failure TTL) cost <50 ms because the cache absorbs them. After the cache settles, the underlying `getBadgeDetail` continues running in the background and populates the cache for the next caller — so even on a timeout, the next poll recovers the real name without re-hitting the upstream.

The earlier "不阻塞 init" phrasing in the cache header docstring was too strong. The accurate phrasing is: "init returns within ~1500 ms regardless of upstream latency; the per-id race ensures the response is never blocked by a slow Main Station." Both phrasings are now consistent in the doc comments and the delivery report.

#### Rollback (deployment-time backup, NOT git revert)
The 4 production files are NOT under git tracking on the working copy (`git status --short` shows them as untracked at this HEAD). Git revert cannot recover them. Rollback therefore depends on the deployment-time snapshot captured under `/var/www/app/.rollback/<snapshot-name>/`. The recommended deployment flow records that path; if it is missing, fall back to the per-file backup written before the overlay (see deploy step B in `audit/hotfix-03-deploy-v2.sh` for the template).

Rollback procedure:
1. `sudo -n pm2 reload repark-h5` (or stop/start) — bring the running process back into a known state.
2. `sudo -n cp -a /var/www/app/.rollback/<snapshot>/app/api/game/milestone/claim/route.ts /var/www/app/app/api/game/milestone/claim/route.ts`
3. Same for `app/api/battle/init/route.ts` and `app/components/features/battle/SubPageModal.tsx`.
4. Delete `/var/www/app/lib/badgeNameCache.ts` (it did not exist before this sprint).
5. `cd /var/www/app && sudo -n NODE_ENV=production npm run build:no-lint`
6. `sudo -n pm2 reload repark-h5 --update-env`
7. `cat /var/www/app/.next/BUILD_ID` to confirm the BUILD_ID changed.

No schema migrations; no DB rollback needed.

#### Lessons Learned
- 玩家实际调用的领取端点 `/api/game/milestone/claim` 之前没调主站 Grant；只有"备用"路径 `/api/battle/reward-claim` 改对了。需要纠正根因记录：以后修复领取链路必须先确认前端实际点击的是哪个 endpoint。
- PM2 console.log 仍然不通 (last write 2026-08-25)，但 Next.js route.js 字符串提取可以做"运行构建中含某符号"的静态证据。
- `audit_log` 表的可用性与覆盖范围未在本次修复范围内验证；不应作为本次到账证据。
- `vitest` is in `node_modules` but NOT in `package.json`'s devDependencies. The deploy package will not change this; we do not need to npm install. If a future deploy DOES run `npm install`, vitest will be removed and the `tests/unit/*.spec.ts` files will become dead weight on the server but will not break the build.

#### Next Step
等待 Commander 决定是否部署到生产。部署后真实联调步骤见交付报告 ⑤节。

---

## Sprint N.1 — Deployment Attempt (2026-09-13)

Commander authorised deployment + automated verification with a 4-file scope (3 modified + 1 new lib). Asked for autonomous execution except where human participation is required.

### Work completed

1. **Pre-deploy local verification (re-confirmed)**:
   - `npx tsc --noEmit` → PASS
   - `npm run build:no-lint` → PASS
   - `node node_modules/vitest/vitest.mjs run` → **36/36 PASS** (6 spec files)

2. **Tar packaging**: `node scripts/package-deploy.mjs` produced `H:\tmp\repark-deploy-2026-09-13.tar.gz` (252,296,898 bytes).

3. **Tar contents verified by direct extraction listing** (NOT by "exclusion whitelist" assumption):
   ```
   ./lib/badgeNameCache.ts                                              ← NEW
   ./app/api/game/milestone/claim/route.ts                              ← MODIFIED
   ./app/api/battle/init/route.ts                                       ← MODIFIED
   ./app/components/features/battle/SubPageModal.tsx                   ← MODIFIED
   ./tests/unit/*.spec.ts × 6                                          ← NEW (test files)
   ./vitest.config.ts                                                   ← NEW (test config)
   ./park-os/memory/EXECUTION_LOG.md                                    ← APPENDED
   ```
   - **No `.env*`, no `*.pem`, no `*.key`, no `secrets/`, no `admin-pw*`** in tar (verified by grep against the archive listing).

4. **ALREADY_CLAIMED HTTP status corrected**: confirmed at `app/api/game/milestone/claim/route.ts:234` that the route returns **HTTP 200 + `{ok:true, code:'ALREADY_CLAIMED'}`** — not 409. This is the P0 8-22 fix where re-clicks on an already-claimed milestone are treated as success to avoid frontend "领取失败" toast noise. The frontend handleClaimReward treats `json?.ok && json.data` as success, so the contract is consistent. Earlier reports of 409 in this session referred to an older state of the code; the current source is the final word.

5. **PM2 exec_mode corrected**: the prior claim "reload = zero-downtime" is **wrong** for this project. `pm2 jlist` shows `exec_mode: fork` for next-server, which means `pm2 reload` is a sequential stop+start and produces a brief service interruption (typically 2–10 s). The deploy script therefore uses `pm2 stop` → file replace → `pm2 start`, NOT `pm2 reload`. This is documented in `audit/deploy-sprint-n-medal-grant.sh`.

6. **Deploy scripts generated** (committed to `.audit/`):
   - `audit/deploy-sprint-n-medal-grant.sh` — main deploy: backup → stage build → swap → health check. Reads `PIPESTATUS[0]` for build exit code (not the `tail` exit). Does not modify HOME. Does not run `pm2 delete`. Does not print secrets.
   - `audit/rollback-sprint-n-medal-grant.sh` — restores backed-up `.next` (no rebuild) and source files.
   - `audit/deploy-precheck.sh` — pre-flight that verifies SSH connectivity, pm2 reachable, /api/time 200, BUILD_ID readable, .rollback/ exists.

### Work blocked (no human-vs-AI preference, hard environmental constraint)

7. **SSH channel to 98.93.252.250 not reachable from this session**:
   - The PowerShell host only carries `~/.ssh/id_ed25519_mercenary_h5` (ED25519, public key comment `mercenary_h5_project`).
   - Previous deploy scripts (`audit/p1_deploy.sh` etc.) reference `mercenary_h5_project.pem` at `/home/ubuntu/keys/mercenary_h5_project.pem` — a `.pem`-format key that does NOT exist on this host (verified by recursive scan of `$HOME`).
   - `ssh -v ubuntu@98.93.252.250` returns `Permission denied (publickey)` after offering the local ED25519 key.
   - Port 22 is reachable (`Test-NetConnection` succeeded). The failure is purely key-mismatch.
   - **No path on this session can execute the deploy**, including upload, backup, build, swap, health check, Detail API call, admin query, DB query, or test-user identification. The instructions in this sprint are the deliverable for a human operator who DOES have access.

8. **Detail API verification blocked**: requires either HMAC signing (needs `WEBHOOK_SECRET`) or a running server with the new build (needs SSH). Neither is available from this session.

9. **Admin activity config query blocked**: every admin route runs `requireAdminAuth(req)` first. No admin credentials are available; the brief explicitly forbids forging cookies.

10. **Test-user identification blocked**: requires SQL access (DB host is private; only reachable from 98.93.252.250).

### Human-actionable steps (max 3)

These three steps complete what this session cannot:

1. **Copy `H:\tmp\repark-deploy-2026-09-13.tar.gz`** to a host that can SSH to 98.93.252.250 with the `mercenary_h5_project.pem` key (the host where the previous deploy scripts were run). Place the tar at `/tmp/repark-deploy-2026-09-13.tar.gz` on that host.
2. **Run the deploy** from that host:
   ```
   bash /tmp/deploy-sprint-n-medal-grant.sh /tmp/repark-deploy-2026-09-13.tar.gz
   ```
   The script handles backup, isolated-stage build, swap, and health checks autonomously. It will refuse to proceed if any step fails.
3. **Run a single real claim** as a logged-in test user (UUID already used in prior sessions: `uuid-128` is the candidate, but the deploy script does NOT auto-issue grants; pick any user who has accumulated enough damage for an unclaimed MEDAL milestone). Open `https://h5.testai1.com/battle`, open the 进度奖励 sheet, tap the lowest eligible MEDAL row. The frontend will POST `/api/game/milestone/claim`; verify the toast shows `获得勋章：<real name>` and report the toast text plus the timestamp. After that, query `https://test.aidpzm.com` (main station) or ask the customer to confirm the same user_id + badge_id appears in their grant list.

If step 3 fails (no eligible test user, main station returns error, etc.), the rollback script recovers the previous build from the snapshot path printed at the end of the deploy script.

### Status flags

- DEPLOY: **BLOCKED** (SSH key mismatch — environmental, not a code issue)
- BUILD_ID: **N/A** (server not reachable)
- HEALTH: **N/A**
- DETAIL: **N/A** (no HMAC + no server reachability)
- 真实领取: **待真人操作**
- 主站到账: **待客户核对**
- 回滚备份: **未生成（无 SSH 通道）**

The deploy script, rollback script, and pre-check script are all in `.audit/` and committed. Running them on a properly-authenticated host completes everything else in one pass.