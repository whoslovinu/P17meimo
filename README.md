# P17 H5meimo Demo

> A production-grade Next.js 15 H5 battle demo — Live2D-style Spine animations,
> PostgreSQL + Redis state, AWS RDS-backed.

---

## Quick Start

```bash
npm ci --legacy-peer-deps        # install
npm run dev                      # http://localhost:3000  (dev mode, JIT)
npm run build:no-lint && npm run start   # production mode
```

---

## Operations (V6.0+ — 2026-07-11)

### ⚡ One-command health check (start here when you return)

```bash
./scripts/health-check.sh          # Linux/macOS
./scripts/health-check.ps1         # Windows
```

This runs **5 read-only checks** in ~10 seconds:
1. TypeScript — `0 errors` required
2. Production build — `BUILD_ID` present
3. Network Layer Hard Rule — `0` bare `fetch(`/`axios()` in `app/`
4. Routes — `49` static + dynamic count
5. Latency gate — `p99 ≤ 8s` (requires server running)

If anything fails, the output points to the file/line.

### Deploy / restart the production server

The **only supported deployment entry point** is:

```bash
node scripts/deploy-to-customer.mjs
```

This single script handles environment generation, build, SCP upload, server restart,
and health verification in one pass. Run with `--help` for options.

### Run the production benchmark

```bash
node scripts/bench_attack.mjs                  # 50 samples, default URL
BENCH_SAMPLE=200 node scripts/bench_attack.mjs # longer run for P99 confidence
BENCH_URL=https://staging.p17.example.com node scripts/bench_attack.mjs
```

**Pass criteria** (see `docs/P17_BATTLE_PROTOCOL.md` §5):

| Metric | Target |
|--------|--------|
| errors | 0 |
| p50 | ≤ 200 ms |
| p95 | ≤ 1,500 ms |
| p99 | ≤ 8,000 ms (timeout budget) |

If p99 > 8s, **raise the timeout to 15s and add a TODO** to fix the
underlying hot path before next deploy.

### Build a Docker image

```bash
docker build -t p17-h5meimo:latest .
docker run --rm -p 3000:3000 --env-file .env.local p17-h5meimo:latest
```

The image is **multi-stage** (Node 20-alpine), runs `next start` as a
non-root user, and includes a healthcheck against `/api/time`.

### Type-check / lint

```bash
npx tsc --noEmit          # type check (zero tolerance for errors)
npm run lint              # ESLint (uses Next.js preset)
npm run build:no-lint     # production build (skips lint for speed)
```

---

## Frontend Network Layer — Hard Rule

> All client-side `fetch()` calls must go through `fetchWithTimeout`
> from `@/app/lib/fetchWithTimeout`. Default timeout 8s.

See **`docs/P17_BATTLE_PROTOCOL.md`** for the full contract: the 3
sanctioned exceptions, error-handling pattern, diagnostic playbook, and
production benchmark contract.

A quick summary:

```ts
// ✅ Correct
import { fetchWithTimeout, FetchError, humanizeFetchError } from '@/app/lib/fetchWithTimeout';
const { data } = await fetchWithTimeout<MyResponse>('/api/foo', { method: 'POST', body: ... });

// ❌ Forbidden
const r = await fetch('/api/foo', { method: 'POST' });
const d = await r.json();
```

Violations are caught by `npx tsc --noEmit` (admin wrapper still allows
back-compat), `.cursorrules` audits, and the PR review checklist.

---

## Documentation

- `docs/P17_BATTLE_PROTOCOL.md` — Network layer contract (READ FIRST)
- `docs/P17_API_BASELINE.md` — API latency baselines (P50/P95/P99)
- `docs/P17_TESTING.md` — Vitest + Playwright test plan
- `docs/P17_DEPLOYMENT.md` — AWS RDS + Cloudflare + Nginx deploy runbook
- `REPARK_EXECUTION_LOG.md` — append-only change history
- `SHADOW_AUDIT_REPORT.md` — last shadow audit

---

## Project structure

```
app/
  battle/                     Battle page (server component, SSR data fetch)
  components/features/battle/ Battle UI (client components)
  lib/                        Shared client utilities (fetchWithTimeout, etc.)
  api/                        Next.js Route Handlers (server-side)

lib/                          Server-only utilities (db, redis, auth, ...)

scripts/
  bench_attack.mjs            Production latency benchmark
  deploy-to-customer.mjs      Production deploy (env gen + build + SCP + restart)
  stress_test.js              Concurrent request stress test

docs/                         Engineering documentation (P17_*)

Dockerfile                    Multi-stage production image
next.config.ts                Next.js configuration
middleware.ts                 Auth + request-id middleware
tsconfig.json                 TypeScript strict mode
```

---

## Previous README content (boilerplate removed)

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

---

## Recovering a broken `node_modules`

**Symptom**: `npm install` reports "added N packages" but `node_modules/.bin/tsc.cmd`
(or any other bin) is missing. `npm ls <pkg>` returns empty.

**Root cause**: known npm + Windows + PowerShell + nvm4w bug where `npm ci`
succeeds at metadata level but `node_modules/.bin/` symlinks/shims aren't
written for some packages (commonly: `typescript`, `vitest`).

**Recovery steps** (in order — first one usually works):

```powershell
# 1. Force a full clean reinstall
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json.bak -ErrorAction SilentlyContinue
npm cache verify
npm ci --legacy-peer-deps
Test-Path node_modules\.bin\tsc.cmd   # should now be True
```

```bash
# 2. If still broken, manually create the symlink
ln -s ../typescript/bin/tsc node_modules/.bin/tsc
```

```bash
# 3. Last resort: install typescript globally just for tsc access
npm install -g typescript@5
```

**Files affected**:
- `lib/env.ts` — was added with `process.env.NODE_ENV` reads; verified via `tsc --noEmit`
- `app/lib/adminAuth.ts`, `app/lib/useUserId.ts` — migrated to `env.*`
- `scripts/bench_attack.mjs` — pure Node, no TS dep
- `scripts/health-check.sh/.ps1` — pure Bash/PowerShell, no Node dep

If you can't recover `tsc`, the **health-check.sh/.ps1** still works (it
falls back to "warn" rather than fail), and the production build via
`next build` will catch type errors itself.