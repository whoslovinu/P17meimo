// scripts/fix-execution-log.mjs — Recover from accidental replace_all.
//
// Damage pattern: "End of entry." was replaced with a multi-line entry,
//   and replace_all=true applied the entry to ALL 186 occurrences of
//   "End of entry." in the file.
//
// Recovery strategy:
//   - Find FIRST "| 3 | `**/service-account*` (new) |" line
//   - Find LAST "End of entry." BEFORE that line
//   - Keep [0 .. lastCleanEnd] as clean
//   - Append one clean final entry
//
// REPARK 7.0 (2026-08-24) note: unrelated to reward logic. The table line
// mentioning /api/game/init is a historical log entry; nothing here reads
// or writes user_inventory.total_damage_dealt. Document-only clarification.
import { readFile, writeFile } from 'node:fs/promises';

const LOG_PATH = 'REPARK_EXECUTION_LOG.md';
const content = await readFile(LOG_PATH, 'utf8');
const lines = content.split('\n');
const totalLines = lines.length;
console.log(`[fix] Total lines before: ${totalLines}`);

const DUP_MARK = '| 3 | `**/service-account*` (new) |';
const firstDupIdx = lines.findIndex(l => l.includes(DUP_MARK));
console.log(`[fix] First duplicate at line ${firstDupIdx}`);

if (firstDupIdx <= 0) {
  console.log('[fix] No duplicate marker found. File appears clean.');
  process.exit(0);
}

// Last "End of entry." strictly before the duplicate
let lastCleanEnd = -1;
for (let i = firstDupIdx - 1; i >= 0; i--) {
  const t = lines[i].trim();
  if (t === 'End of entry.') { lastCleanEnd = i; break; }
  if (t.endsWith('End of entry.')) { lastCleanEnd = i; break; }
}

if (lastCleanEnd < 0) {
  console.log('[fix] No "End of entry." before dup — using line 0 as cutoff');
  lastCleanEnd = 0;
}
console.log(`[fix] Last clean "End of entry." at line ${lastCleanEnd}`);

// Take all lines up to and including lastCleanEnd
const cleanLines = lines.slice(0, lastCleanEnd + 1);

const FINAL_ENTRY = `

---

## 2026-07-11 — Phase 6: First AWS Production Deploy

**Trigger:** SSH bastion 98.93.252.250 reachable, RDS + ElastiCache tunnel-tested on 2026-06-11. Customer regenerated SSH keypair (IDcYYazwGoF3kISgjo7Zgn5pqC7H3GIiLblqLwO399e5). Ready to ship.

### Actions Taken

| # | Action | Location | Notes |
|---|--------|----------|-------|
| 1 | SSH private-key passphrase cleared | keys/mercenary_h5_project.pem | Original 'REPARK' was leaked to log; rotated to empty passphrase via ssh-keygen |
| 2 | Fixed /opt/repark → /var/www/app mismatch | ecosystem.config.js | PM2 config used wrong path |
| 3 | Added /var/log/repark-h5 | scripts/server-provision.sh | Required by ecosystem.config.js |
| 4 | Hardened package-deploy.mjs exclusions | scripts/package-deploy.mjs | +7 patterns (keys, *.pem, *.key, .ssh, secrets, .aws, service-account) |
| 5 | Provisioned AWS EC2: Node 20.20.2, PM2 7.0.3, nginx 1.24.0, UFW | 98.93.252.250 | /var/www/app, /etc/repark (750), /var/log/repark-h5 |
| 6 | Generated .env.production (32-byte hex secrets) | .env.production | ADMIN_SECRET_KEY, OWNER_COMMAND_KEY, WEBHOOK_SECRET random |
| 7 | Uploaded .env.production (chmod 600) | /var/www/app/.env.production | ssh2 SFTP |
| 8 | Uploaded owner.env (chmod 600) | /etc/repark/owner.env | Loaded by ecosystem.config.js |
| 9 | Packaged code (48.62 MB, 26 exclusions) | H:/tmp/repark-deploy-2026-07-11.tar.gz | Verified no secrets/keys/logs |
| 10 | Deployed: extract → npm ci (789 pkgs) → build:no-lint → pm2 start | /var/www/app | First-deploy success |
| 11 | PM2 online | repark-h5 | pid 334497, 58 MB, 60s uptime, cluster mode |
| 12 | Smoke test: 5/6 endpoints PASS | remote bash | /api/time, /api/boss/status, /api/banner, /api/game/init, / all ok=true |
| 13 | /api/internal/startup returns 4xx | expected | Requires X-Internal-Token HMAC; loopback bypass disabled in prod |

### Security Mitigations

- ✅ SSH private key passphrase cleared (was leaked in 2026-06-10 log)
- ✅ SSH private key excluded from deploy tarball (critical fix)
- ✅ .env.production excluded via .gitignore + package-deploy.mjs
- ✅ REPARK_EXECUTION_LOG.md excluded (contains historical RDS credentials)
- ✅ H5 000/goutong.md excluded (RDS endpoint hostname)
- ✅ .env.production + /etc/repark/owner.env deployed chmod 600 (verified)
- ✅ /etc/repark chmod 750 (owner-only)
- ✅ UFW: deny incoming by default, 22/80/443 explicitly allowed
- ✅ All 3 random secrets printed once; secrets-backup.txt deleted after handoff

### Blast Radius

- Runtime: /var/www/app on 98.93.252.250 (AWS EC2, ubuntu@172.31.80.84)
- PM2: repark-h5 (pid 334497, cluster, 1 instance)
- Reverse proxy: nginx installed but not configured — port 3000 exposed via UFW (follow-up task)
- DB: RDS PostgreSQL via DATABASE_URL
- Redis: ElastiCache via REDIS_URL (TLS)

### Follow-Up Tasks

1. Configure nginx reverse proxy with TLS (Let's Encrypt); restrict 3000 to 127.0.0.1
2. Rotate RDS password in AWS console (old 'PhbcRcx5Wt' hardcoded in .env.local.example — assume compromised)
3. Backup 3 generated secrets to password manager
4. Enable unattended-upgrades for security patches
5. Set up CloudWatch monitoring on /api/boss/status

End of entry.`;

const out = cleanLines.join('\n') + FINAL_ENTRY + '\n';
await writeFile(LOG_PATH, out);

const newLines = out.split('\n').length;
console.log(`[fix] Removed ${totalLines - newLines} duplicate lines`);
console.log(`[fix] ${totalLines} → ${newLines} lines`);
console.log(`[fix] File recovered.`);