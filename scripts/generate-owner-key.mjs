#!/usr/bin/env node
/**
 * generate-owner-key.mjs — Generate a fresh OWNER_COMMAND_KEY (and / or
 * OWNER_HEARTBEAT_KEY). Outputs a 64-character hex string (32 random bytes).
 *
 * Usage:
 *   node scripts/generate-owner-key.mjs
 *   node scripts/generate-owner-key.mjs --out env
 *
 * The `--out env` flag writes the new key to a `.owner-key` file (chmod 600)
 * you should immediately copy into your password manager. The file lives at
 * <cwd>/.owner-key by default and is excluded from `.gitignore`.
 *
 * SECURITY:
 *   - Never commit the generated key to source control.
 *   - Never share it with the customer.
 *   - The key is meant to live ONLY in:
 *       (a) your password manager,
 *       (b) the deployment platform's secret store (e.g. AWS SSM / Vercel env),
 *       (c) the customer's EC2 `/etc/repark/owner.env` (chmod 600).
 */

import { randomBytes } from 'node:crypto';
import { writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';

const WANTED_BYTES = 32;

function genKeyHex() {
  return randomBytes(WANTED_BYTES).toString('hex');
}

const argv = process.argv.slice(2);
const wantFile = argv.includes('--out');
const labelArg = argv.find((a) => a.startsWith('--label='));
const label = labelArg ? labelArg.slice('--label='.length) : 'OWNER_COMMAND_KEY';

const hex = genKeyHex();

console.log(`\nGenerated ${label} (${WANTED_BYTES * 8} bits):`);
console.log('');
console.log(`  ${label}=${hex}`);
console.log('');

if (wantFile) {
  const path = resolve(process.cwd(), '.owner-key');
  writeFileSync(path, `${label}=${hex}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* non-POSIX filesystem — the umask is the best we can do */
  }
  console.log(`Wrote to: ${path}`);
  console.log('Run `Get-Content .owner-key` (Windows) or `cat .owner-key` (mac/linux) to view.');
} else {
  console.log('Tip: pass --out to also write to ./.owner-key (chmod 600).');
  console.log('');
}

console.log('DO NOT commit this key to git. Store it in your password manager.');
console.log('Rotate keys quarterly (re-run this script, then update the env vars).');