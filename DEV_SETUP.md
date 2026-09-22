# P17_H5meimo-demo — Local Development Setup

This document is the **onboarding runbook** for new operators working on the
魅魔来袭 (Succubus Strikes) H5 project. It covers the SSH tunnel, env vars,
the dev-bypass admin login, and the SQL migration injector script.

If you only need to **run the app locally**, follow the 6 steps in
[§ Quick Start](#quick-start). Everything else is reference material.

---

## Quick Start

> Prerequisites: Node.js 20+, an `npm install` run, and access to the
> REPARK bastion host key (`keys/mercenary_h5_project.pem`). psql is
> **not** required.

1. **Copy the env template**

   ```powershell
   cp .env.local.example .env.local
   ```

   `.env.local` is gitignored. Leave `ADMIN_SECRET_KEY=` blank for dev —
   the dev-bypass will handle admin login (see § Admin Auth).

2. **Open a second terminal and start the SSH tunnel**

   ```powershell
   $env:DEPLOY_SSH_PASSPHRASE='REPARK'
   node scripts/dev_tunnel.mjs
   ```

   You should see:

   ```
   [TUNNEL] local:5433  -> rp1.c3qwr1tw0j.us-east-1.rds.amazonaws.com:5432
   [TUNNEL] local:6380  -> rp1-bkmbmc.serverless.use1.cache.amazonaws.com:6379
   [TUNNEL] tunnel established
   ```

   The tunnel must stay running for the app to talk to RDS / ElastiCache.

3. **(One-time per environment) Apply the SQL migrations**

   In a third terminal:

   ```powershell
   node scripts/inject_sql.mjs --dry      # preview, no writes
   node scripts/inject_sql.mjs            # apply
   ```

   This script is idempotent — running it twice is safe.

4. **Start the dev server**

   ```powershell
   npm run dev
   ```

5. **Visit the battle page**

   http://localhost:3000/battle?uid=demo-user

   The `uid` query parameter (or the `uid` cookie) is the only auth the
   client app requires in development.

6. **Open the admin panel**

   http://localhost:3000/admin/login

   - If `ADMIN_SECRET_KEY` is blank: password is literally `dev`.
   - If `ADMIN_SECRET_KEY` is set: password equals that value.

---

## Environment Variables

| Variable                          | Required in Dev | Purpose                                                                                    |
| --------------------------------- | --------------- | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                    | yes             | PostgreSQL connection string (local tunnel = `127.0.0.1:5433`).                            |
| `REDIS_URL`                       | yes             | Redis connection string (local tunnel = `127.0.0.1:6380`).                                 |
| `NEXT_PUBLIC_APP_URL`             | yes             | Public origin used for OAuth redirects etc.                                                |
| `NEXT_PUBLIC_AUTH_COOKIE_NAME`    | no (default `uid`) | Cookie name the Main Station sets to identify a user.                                   |
| `NEXT_PUBLIC_MAIN_STATION_URL`    | no              | Where `/battle` redirects when the user is unauthenticated.                                |
| `ADMIN_SECRET_KEY`                | **dev optional** | HMAC key that signs the `admin_token` cookie. Empty + `ADMIN_DEV_BYPASS=1` = dev login. |
| `ADMIN_DEV_BYPASS`                | **dev optional** | `1` enables a static-bypass admin token **only when NODE_ENV != production**.             |
| `WEBHOOK_SECRET`                  | yes (prod)      | HMAC secret for incoming Main-Station webhooks.                                             |
| `SUPABASE_URL` / `SUPABASE_*`     | NO              | **Deprecated.** The Supabase SaaS project was decommissioned. Do not re-introduce.         |

> See `.env.local.example` for the canonical annotated list.

---

## Admin Auth (Dev vs. Prod)

The admin login flow is HMAC-SHA256 based. Cookie format:

```
admin_token={expiry_timestamp}:{HMAC-SHA256(ADMIN_SECRET_KEY, expiry_timestamp)}
```

The token expires 24 hours after issuance. Verification is constant-time
and reject-by-default.

### Local dev without a secret

Two flags cooperate:

- `ADMIN_SECRET_KEY=` (blank)
- `ADMIN_DEV_BYPASS=1` (any non-prod env)

When both are true:

- Login accepts the literal password `dev` and issues a static cookie
  `admin_token=authenticated`.
- The dev bypass is gated by `isAdminDevBypass()` in
  `app/lib/adminToken.ts` — **it is impossible to enable in production**
  because the function checks `NODE_ENV` first.

### Production

- `ADMIN_SECRET_KEY` must be set to a random 32-byte hex string:
  ```powershell
  $key = [Convert]::ToHex((New-Object byte[] 32 -Property {Get-Random -Max 256 | % {$_}} | % {$_}))
  # simpler:
  openssl rand -hex 32
  ```
- `ADMIN_DEV_BYPASS` is **ignored** in production, regardless of value.
- Missing `ADMIN_SECRET_KEY` in production = the admin panel is locked
  and the API returns HTTP 500 with `MISCONFIGURED`.

---

## SQL Migrations — `scripts/inject_sql.mjs`

The Commander's Windows machine does not have `psql` installed. We use
Node + `pg` to apply migrations over the SSH tunnel.

### Flags

| Flag                | Effect                                                       |
| ------------------- | ------------------------------------------------------------ |
| (none)              | Connect and apply every migration in order.                  |
| `--dry`             | Print every migration to stdout; **do not connect or write.** |
| `--list`            | Print the manifest and exit.                                 |
| `--only=<substring>`| Apply only migrations whose filename contains `<substring>`.|

### Exit codes

| Code | Meaning                                            |
| ---- | -------------------------------------------------- |
| 0    | All migrations applied (or already present).       |
| 1    | Connection failed (tunnel down, bad creds, etc.).  |
| 2    | SQL error during migration; re-run is safe.        |
| 3    | Bad CLI usage or missing migration file.           |

### Who can run it

Anyone with:

1. Access to the bastion key + passphrase.
2. The password matching `DATABASE_URL`.
3. Node 20+ on their workstation.

The script does **not** modify the database schema outside the migration
files. It is safe to run in any environment where the listed SQL files
are the intended next state. **Production schema changes still go
through the standard change-management flow** — `inject_sql.mjs` is a
local-dev convenience, not a deployment tool.

### Adding a new migration

1. Create `aws_rds_init/aws_0X_<short_name>.sql`. Use `IF NOT EXISTS`,
   `CREATE OR REPLACE`, etc. so the script remains idempotent.
2. Append `{ name: 'aws_0X_<short_name>.sql', path: resolve(...) }` to
   the `MIGRATIONS` array in `scripts/inject_sql.mjs`.
3. Run `node scripts/inject_sql.mjs --dry` to preview, then run again
   without `--dry` to apply.
4. Verify with `node scripts/inject_sql.mjs` again — the second run
   should report everything as already present.

---

## Common Tasks

### Tunnel won't come up

```
[SSH] Error: connect ECONNREFUSED 98.93.252.250:22
```

- The bastion host (`98.93.252.250`) is unreachable from your network.
- Confirm VPN is connected and that the IP is allowed by the security group.
- If you're on a different network, ask the Commander for a new IP whitelist entry.

### I keep seeing "MISCONFIGURED" on /api/admin/*

- Dev: set `ADMIN_DEV_BYPASS=1` in `.env.local` and restart `npm run dev`.
- Prod: `ADMIN_SECRET_KEY` must be set in the hosting platform's env.

### Postgres migration says `42P07` (duplicate_object)

That's expected. The migrations use `IF NOT EXISTS`. The script logs it
and continues. If you see `42P07` *and* `verifySchema` reports
`MISSING`, then the migration order is broken — file an issue.

### Redis commands hang

The Redis TLS connection is local-only (`127.0.0.1:6380`). The
`tls.rejectUnauthorized=false` flag is hard-coded in `lib/redis.ts` for
dev only — production must use a properly-signed certificate.

---

## Architecture Cheat-Sheet

```
Browser  ──►  Next.js (3000)
                  │
                  ├──► RDS PostgreSQL   (via SSH tunnel: 5433 → 5432)
                  └──► ElastiCache Redis (via SSH tunnel: 6380 → 6379)
```

- **No Supabase.** The Supabase SaaS dependency was removed in Phase 4.
- **No local FS writes** from serverless routes. All uploads go through
  `lib/upload.ts` (mock/local/S3 backends).
- **All admin requests** are gated by `middleware.ts` + `requireAdminAuth`.
- **State machines** for attack processing live in
  `app/api/action/attack/route.ts` (Redis Lua atomic).

See `REPARK_EXECUTION_LOG.md` for the full audit history.