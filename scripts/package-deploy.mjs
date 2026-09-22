#!/usr/bin/env node
/**
 * scripts/package-deploy.mjs
 *
 * 在本机运行：打包代码用于 SCP 上传到客户服务器。
 * 排除 node_modules / .next / .git / .env.local 等。
 *
 * Usage:
 *   node scripts/package-deploy.mjs
 *   node scripts/package-deploy.mjs --output=H:\tmp\repark-deploy-2026-07-11.tar.gz
 *
 * Output:
 *   - repark-deploy-{YYYY-MM-DD}.tar.gz in --output dir (default: H:/tmp)
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};

const ROOT = process.cwd();
const today = new Date().toISOString().slice(0, 10);
const OUTPUT = getArg('--output', `H:/tmp/repark-deploy-${today}.tar.gz`).replace(/\//g, '\\');

// ── Validate ────────────────────────────────────────────────────────────────
const exclusions = [
  // ── Source-controlled build artefacts ──────────────────────────────────────
  'node_modules',
  '.next',
  '.git',
  'coverage',
  'tests-output',
  'playwright-report',
  '.playwright',
  'out',
  'build',
  'dist',
  '.turbo',
  '.cache',
  '*.tsbuildinfo',

  // ── Logs and ephemeral debug ───────────────────────────────────────────────
  '*.log',
  'logs',
  '*.tmp',
  '*.bak',
  '*.old',
  '*.swp',
  '*.swo',
  'temp-*.mjs',
  'temp-*.cjs',
  'temp-*.py',
  'temp-*',
  '*.last-run.json',

  // ── Test & CI artefacts ────────────────────────────────────────────────────
  'test-results',
  'verify_result.json',
  'verify_result.png',
  'bench-results.xml',
  'junit*.xml',
  '.nyc_output',

  // ── Env files (keep .env.example — that is the COMMITTED public template) ─
  '.env',
  '.env.*',
  '!.env.example',
  '.env.local',
  '.env.local.example',
  '.env.production',
  '.env.development',
  '.env.test',
  '.env.staging',

  // ── Runtime / business data ────────────────────────────────────────────────
  'backups',
  'tmp',
  'public/uploads',
  'H5 000',                       // upstream Live2D reference pack — superseded by public/H501
  'agent-transcripts',
  'REPARK_EXECUTION_LOG.md',
  'docs/INTERNAL*',

  // ── IDE / tooling metadata ─────────────────────────────────────────────────
  '.cursor',
  '.cursorignore',
  '.vscode',
  '.idea',
  '.github',

  // ── SECURITY: never include deploy credentials ────────────────────────────
  'keys',                         // SSH private keys live here
  '*.pem',
  '*.archived.pem',
  '*.archived',
  'admin-pw.txt',
  'admin-pw.*.txt',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.crt',
  '*.cer',
  '.ssh',
  'secrets',
  '.aws',
  '.owner-key',
  '**/service-account*',
];

const excludeArgs = exclusions.flatMap((e) => ['--exclude', e]);

// ── Make output dir ─────────────────────────────────────────────────────────
const outputDir = dirname(OUTPUT);
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
  console.log(`[package-deploy] created output dir: ${outputDir}`);
}

// ── tar invocation ──────────────────────────────────────────────────────────
// Note: We use the system `tar` (works on Windows 10+ with bsdtar built-in).
// We pack from ROOT with --exclude, writing the tar to OUTPUT.
console.log(`[package-deploy] creating ${OUTPUT}`);
console.log(`[package-deploy] excludes: ${exclusions.length} patterns`);

const cmd = `tar -czf "${OUTPUT}" ${excludeArgs.map((a) => `"${a}"`).join(' ')} .`;
try {
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
} catch (e) {
  console.error(`[package-deploy] FAILED: ${e.message}`);
  process.exit(1);
}

// ── Verify ──────────────────────────────────────────────────────────────────
const sizeBytes = statSync(OUTPUT).size;
const sizeMB = (sizeBytes / 1024 / 1024).toFixed(2);
console.log(`[package-deploy] OK — ${OUTPUT} (${sizeMB} MB)`);

// ── Next steps ──────────────────────────────────────────────────────────────
console.log('');
console.log('Next steps (with VPN connected):');
console.log('');
console.log(`  # 1. SCP upload to AWS EC2`);
console.log(`  scp ${OUTPUT} ubuntu@98.93.252.250:/tmp/`);
console.log('');
console.log(`  # 2. SSH into server`);
console.log(`  ssh ubuntu@98.93.252.250`);
console.log('');
console.log(`  # 3. On server: extract, install, build, start`);
console.log(`  mkdir -p /var/www/app && cd /var/www/app`);
console.log(`  tar -xzf /tmp/repark-deploy-${today}.tar.gz -C /var/www/app`);
console.log(`  ./scripts/server-provision.sh    # first-time: installs Node, PM2, Nginx`);
console.log(`  ./scripts/server-first-deploy.sh # extract + build + pm2 start`);
console.log('');
console.log(`  # 4. Open in browser`);
console.log(`  http://98.93.252.250:3000`);
console.log('');
console.log(`  # 5. For customer-facing verification, run`);
console.log(`  ./scripts/server-acceptance-test.sh`);