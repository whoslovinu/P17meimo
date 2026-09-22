# 馃洝锔?Owner Key Management 鈥?How to Keep Your Hook Alive

> **Audience**: You (the developer), not the customer.
> **Phase**: 10 (Hooks 3 + 4)

This document explains how to **safely store, rotate, and use** the secret keys
that power the owner-command endpoint and (optionally) the startup heartbeat.
If you read nothing else, read the **Storage Tier List** below.

---

## 1. Why these keys exist

The customer who deploys this app on their EC2 will have:

- Full read access to the codebase.
- Full SSH access to the EC2 instance (you gave it to them).
- Full read access to `~/.env` files on that box.
- The ability to `grep -r` the entire filesystem.

You still want to be able to:

- Inspect deployment state without their cooperation.
- Lock them out of the admin panel after delivery if they withhold payment.
- "Turn off" their deployment if they ship a fork that violates the contract.

The hooks give you that power **without** requiring you to leave a literal
`master_password = "owner-can-take-over"` line anywhere in source.

---

## 2. Storage Tier List (best 鈫?worst)

| Tier | Where it lives | Survives box rebuild? | Customer can read? |
|---|---|---|---|
| 馃 **Your password manager** (1Password / Bitwarden / KeePass) | Your local machine | Yes | **No** |
| 馃 **Your private git repo** (encrypted with `git-crypt`) | A private GitHub/GitLab repo you own | Yes | **No** |
| 馃 **AWS SSM Parameter Store** (in YOUR AWS account) | Encrypted, KMS-backed | Yes (you control AWS) | No |
| 馃 **The customer's `/etc/repark/owner.env`** | The customer's EC2 | No | Yes (but they need to actively look) |
| 鉂?**Hardcoded in the codebase** | Source repo | Yes | **Yes 鈥?do not do this** |
| 鉂?**`.env.local` committed to source** | Source repo | Yes | **Yes 鈥?do not do this** |

**Rule of thumb**: your operational key lives in **Tier 1 + Tier 3**. Tier 3
is the customer's box; Tier 1 is your offsite backup.

---

## 3. Generating a fresh key

```bash
node scripts/generate-owner-key.mjs
```

Outputs a 64-character hex string (32 random bytes). You can pass `--out` to
also write it to `.owner-key` (chmod 600, gitignored).

Re-run quarterly to rotate. Old keys remain valid for the duration of the
replay window (5 minutes) AFTER rotation, so coordinate rotations carefully.

---

## 4. Two keys, not one

There are **two** distinct keys:

### 4.1 `OWNER_COMMAND_KEY`

- Used by `/api/internal/owner-command`.
- 32-byte hex (64 chars), min 32 chars.
- Lives on the **customer's** EC2 (so the app can verify your commands).
- Lives on **your** password manager + AWS SSM (so you can sign commands).
- **Do NOT** include this value in any documentation you share with the customer.

### 4.2 `OWNER_HEARTBEAT_KEY`

- Used only by the **optional** startup heartbeat (Hook 4).
- Same format: 32-byte hex.
- Lives in **two places**:
  - On the customer's EC2 (so the app can sign its heartbeat).
  - On the heartbeat URL host (so it can verify).
- **You are NOT a participant** in the heartbeat key 鈥?only the customer and
  the URL host. This key is **for the heartbeat deployment**, not for you.

If you do not operate a heartbeat URL, **do not set these env vars** 鈥?
the heartbeat check is opt-in and defaults to "always pass".

---

## 5. Setting up `OWNER_COMMAND_KEY`

### On your machine (password manager)

1. Generate: `node scripts/generate-owner-key.mjs --label=OWNER_COMMAND_KEY`
2. Copy the hex into your password manager under the entry **"P17 H5 鈥?owner-command"**.
3. Add a note: "Rotate quarterly. Customer: <name>. Deploy date: <date>."

### On the customer's EC2

```bash
# 1. SSH into the customer's EC2 as the deploy user.
ssh deploy@<customer-ec2-host>

# 2. Create the directory if needed.
sudo mkdir -p /etc/repark && sudo chown deploy:deploy /etc/repark
chmod 700 /etc/repark

# 3. Write the key file (paste the value from your password manager).
cat > /etc/repark/owner.env <<'EOF'
OWNER_COMMAND_KEY=<paste hex here>
EOF
chmod 600 /etc/repark/owner.env
```

### Loading it into the running app

If you're using PM2 with `ecosystem.config.js`:

```js
// ecosystem.config.js (snippet)
module.exports = {
  apps: [{
    name: 'repark-h5',
    script: 'npm',
    args: 'start',
    env: {
      NODE_ENV: 'production',
      // ... your other env vars
      OWNER_COMMAND_KEY: process.env.OWNER_COMMAND_KEY, // pm2 will resolve at launch
    },
    // Or use env_file:
    // env_file: '/etc/repark/owner.env',
  }],
};
```

The cleanest pattern: put the key in `/etc/repark/owner.env`, then have PM2
load it via `env_file:`. **Do not check `/etc/repark/owner.env` into git.**

### Verification

After deploying:

```bash
# From your machine, with the key in $OWNER_KEY locally:
TIMESTAMP=$(date +%s%3N)
NONCE=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")
CMD='ping'
ARGS_JSON='{}'
PAYLOAD="${TIMESTAMP}|${NONCE}|${CMD}|${ARGS_JSON}"
SIG=$(node -e "console.log(require('crypto').createHmac('sha256', process.env.OWNER_KEY).update(process.argv[1]).digest('hex'))" "$PAYLOAD")
HEADER="${TIMESTAMP}.${NONCE}.${SIG}"

curl -X POST "https://<customer-host>/api/internal/owner-command?cmd=${CMD}" \
  -H "X-Owner-Auth: ${HEADER}" \
  -H "Content-Type: application/json" \
  -d "{\"cmd\":\"${CMD}\",\"argsJson\":\"${ARGS_JSON}\"}"
```

Expected response:

```json
{ "ok": true, "cmd": "ping", "serverTimeMs": ..., "data": { "pong": true, "serverTimeMs": ... } }
```

If you get `401 signature_rejected`, double-check (a) the key on your
machine matches the key on the customer's box exactly, (b) the timestamp is
within 卤5 minutes, (c) you have not reused the nonce from a previous test.

---

## 6. Command cheat sheet

| Command | What it does | Customer impact |
|---|---|---|
| `ping` | Liveness check | None |
| `get_state` | Returns uptime, redis health, admin-lock epoch | None (read-only) |
| `read_lock_state` | Returns `{ locked, epoch }` | None (read-only) |
| `lock_admin` | Sets `repark:admin:lock_epoch` to current ms | **All admin tokens become invalid on next request** |
| `unlock_admin` | Deletes `repark:admin:lock_epoch` | Admin tokens issued after lock will work (existing cookies still invalid until re-login) |
| `revoke_user_session` | Sets `repark:user:tombstone:<userId>` for N seconds | **A single user is blocked from attacking** for that window |

**status (2026-08-09)**: `lock_admin` is FULLY WIRED as of Phase 11. `app/lib/adminAuth.ts` `requireAdminAuth` reads `repark:admin:lock_epoch` from Redis on every admin API request (line 100-128) and rejects tokens whose issuedAt timestamp predates the lock epoch. End-to-end verified via `/tmp/test-lock-admin-v2.sh`: `lock_admin` writes Redis epoch; subsequent admin API returns 401 `token_revoked_by_lock`. To re-enable: `unlock_admin`. (Phase 10 historical note below — superseded.)

---

## 7. Rotation procedure (quarterly)

```bash
# 1. Generate the new key.
node scripts/generate-owner-key.mjs --label=OWNER_COMMAND_KEY

# 2. Save to your password manager. Note the old value's last-use date.

# 3. On the customer's EC2, edit /etc/repark/owner.env.
ssh deploy@<customer-ec2>
$EDITOR /etc/repark/owner.env
chmod 600 /etc/repark/owner.env

# 4. Reload the app.
pm2 reload repark-h5

# 5. From your machine, send a ping with the NEW key to verify.
# (see 搂 5)
```

Both keys are independent 鈥?rotating one does NOT rotate the other.
Customers do not see this happen. There is no audit email sent.

---

## 8. If the customer tries to break the contract

| Scenario | Your move |
|---|---|
| They threaten to withhold payment | Set a calendar reminder. Do NOT lock them yet. |
| They actually default | `lock_admin` 鈥?they're locked out, gameplay keeps running. |
| They ship a forked copy | `unlock_admin` then `lock_admin` to force re-signing. (Effectively, you keep the kill switch even if they fork.) |
| They claim the heartbeat is "down" | Set your own fallback heartbeat URL. Their fork cannot talk to your URL. |
| They go silent for 30+ days | Consider `lock_admin` + an email reminder. |

---

## 9. What is NOT protected

The hooks do **not** protect:

- The customer's ability to **read** your source code.
- The customer's ability to **modify** source code on their own EC2.
- Customer's gameplay data (HP, attack logs) 鈥?those are theirs.
- Backups they take before deploying.

The hooks DO protect:

- The admin panel (lock_admin / unlock_admin).
- The ability to remotely inspect state.
- The ability to revoke a specific user's session.
- (Optional) the ability to refuse to start the server at all (heartbeat).

---

*Last updated: Phase 10 (Owner-Command + Heartbeat implementation)*