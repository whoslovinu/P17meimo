#!/usr/bin/env node
/**
 * scripts/generate-internal-key.mjs
 *
 * Generates a fresh 32-byte (64 hex chars) shared secret for the
 * /api/internal/startup HMAC gate.
 *
 * Usage:
 *   node scripts/generate-internal-key.mjs
 *
 * Then paste the printed value into .env.local:
 *   INTERNAL_STARTUP_KEY=<printed-value>
 *
 * In production, set the same variable via your hosting-platform's
 * env-var interface (Vercel/Render/Fly/AWS SSM Parameter Store / etc).
 *
 * Rotating the key invalidates ALL outstanding internal tokens
 * (they expire in 5 minutes anyway, but a rotation gives you
 * instant revocation).
 */

import { webcrypto } from 'node:crypto';

const bytes = new Uint8Array(32);
webcrypto.getRandomValues(bytes);
const hex = Array.from(bytes)
  .map((b) => b.toString(16).padStart(2, '0'))
  .join('');

console.log('# Generated INTERNAL_STARTUP_KEY — paste this into .env.local');
console.log(`INTERNAL_STARTUP_KEY=${hex}`);
console.log('');
console.log('# Verify the value matches /^[a-f0-9]{64}$/ (64 hex chars).');