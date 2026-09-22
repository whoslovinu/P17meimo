// scripts/mint-env-production.mjs — Non-interactive .env.production generator.
// Prints all generated secrets to the terminal for backup.
//
// Usage:
//   node scripts/mint-env-production.mjs
//
// Required env vars (or defaults below):
//   DATABASE_URL — full Postgres URL
//   REDIS_URL — full Redis URL
//   APP_URL — public-facing app URL
//
// Generated (random 32-byte hex):
//   ADMIN_SECRET_KEY, OWNER_COMMAND_KEY, WEBHOOK_SECRET
import { writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:PhbcRcx5Wt@rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com:5432/postgres';
const REDIS_URL = process.env.REDIS_URL
  || 'rediss://rp1-bkmbmc.serverless.use1.cache.amazonaws.com:6379';
const APP_URL = process.env.APP_URL || 'http://98.93.252.250:3000';

const ADMIN_SECRET_KEY = randomBytes(32).toString('hex');
const OWNER_COMMAND_KEY = randomBytes(32).toString('hex');
const WEBHOOK_SECRET = randomBytes(32).toString('hex');

const ts = new Date().toISOString();

const lines = [
  '# ============================================================',
  '# P17 H5 — Production Environment (auto-minted, NOT for git)',
  `# Generated: ${ts}`,
  '# ============================================================',
  '',
  '# ── Application ───────────────────────────────────────────────',
  'NODE_ENV=production',
  `NEXT_PUBLIC_APP_URL=${APP_URL}`,
  '',
  '# ── PostgreSQL (RDS) ──────────────────────────────────────────',
  `# ⚠️  Password embedded. Rotate on AWS RDS, then update this file.`,
  `DATABASE_URL=${DATABASE_URL}`,
  '',
  '# ── Redis (ElastiCache, TLS) ──────────────────────────────────',
  'REDIS_TLS=true',
  `REDIS_URL=${REDIS_URL}`,
  '',
  '# ── Admin Authentication (HMAC-SHA256) ────────────────────────',
  `# Backend compares SHA256(input_password) against this value.`,
  `# To set login password = "YourChosenPassword":`,
  `#   node -e "console.log(require('crypto').createHash('sha256').update('YourChosenPassword').digest('hex'))"`,
  `# then replace this line with that hex value.`,
  `ADMIN_SECRET_KEY=${ADMIN_SECRET_KEY}`,
  '',
  '# ── Owner Command (BACKDOOR — DO NOT SHARE WITH CUSTOMER) ──────',
  '# /etc/repark/owner.env is loaded by ecosystem.config.js',
  'OWNER_COMMAND_KEY=' + OWNER_COMMAND_KEY,  // keep for env_file fallback
  '',
  '# ── Webhook (shared with Main Station, HMAC-SHA256) ────────────',
  `WEBHOOK_SECRET=${WEBHOOK_SECRET}`,
  '',
  '# ── Auth Cookie Integration with Main Station ─────────────────',
  'NEXT_PUBLIC_AUTH_COOKIE_NAME=uid',
  `NEXT_PUBLIC_MAIN_STATION_URL=${APP_URL}`,
  '',
  '# ── Game Tuning ───────────────────────────────────────────────',
  'NEXT_PUBLIC_TASK_THRESHOLD_ENERGY=100',
  'NEXT_PUBLIC_TASK_THRESHOLD_RECHARGE=5000',
  'ADMIN_INVENTORY_MAX_PER_TYPE=10000',
];

const outPath = '.env.production';
if (existsSync(outPath)) {
  console.error(`⚠️  ${outPath} already exists — refusing to overwrite.`);
  console.error(`    Delete it first if you want to regenerate.`);
  process.exit(1);
}

writeFileSync(outPath, lines.join('\n') + '\n', { mode: 0o600 });

console.log('');
console.log('════════════════════════════════════════════════════════════');
console.log('  ✅ .env.production generated');
console.log('════════════════════════════════════════════════════════════');
console.log(`  Path:        ${outPath}`);
console.log(`  Generated:   ${ts}`);
console.log('');
console.log('  🔐 SECRETS (BACK THESE UP TO YOUR PASSWORD MANAGER NOW):');
console.log('');
console.log(`  ADMIN_SECRET_KEY     = ${ADMIN_SECRET_KEY}`);
console.log(`  OWNER_COMMAND_KEY    = ${OWNER_COMMAND_KEY}`);
console.log(`  WEBHOOK_SECRET       = ${WEBHOOK_SECRET}`);
console.log('');
console.log('  DATABASE_URL         = ' + DATABASE_URL.replace(/:[^:@/]*@/, ':***@'));
console.log('  REDIS_URL            = ' + REDIS_URL);
console.log('  APP_URL              = ' + APP_URL);
console.log('');
console.log('════════════════════════════════════════════════════════════');
console.log('  Next steps:');
console.log('    1. Backup the 3 secrets above to 1Password / Bitwarden');
console.log('    2. node scripts/deploy-app.mjs   # uploads + extracts + builds');
console.log('════════════════════════════════════════════════════════════');