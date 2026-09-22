/**
 * ecosystem.config.js — PM2 process manager config for Repark H5
 *
 * P0 2026-08-19 FIX (REPARK CRITICAL EMERGENCY):
 *   The previous config referenced `/var/www/app/next-start.sh` (a missing
 *   script). PM2 then started `next start` directly without the right
 *   `cwd` / `NODE_ENV=production`, leading to an incomplete `.next/`
 *   state being served → 400 Bad Request on `/_next/static/chunks/*.js`
 *   and CSS, causing white-screen.
 *
 *   This config uses the canonical next CLI path, explicit args, and
 *   NODE_ENV=production in the default `env` block (so `pm2 start`
 *   without `--env production` also gets the right mode).
 */

function loadOwnerEnv() {
  const fs = require('fs');
  const envPath = '/etc/repark/owner.env';
  const env = {};
  if (fs.existsSync(envPath)) {
    try {
      const stat = fs.statSync(envPath);
      const mode = stat.mode & 0o777;
      if (mode !== 0o600) {
        console.warn(`[PM2] Warning: ${envPath} has permissions ${mode.toString(8)}, should be 0600`);
      }
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (key) env[key] = value;
      }
      console.log(`[PM2] Loaded ${envPath} (${Object.keys(env).length} vars)`);
    } catch (e) {
      console.warn(`[PM2] Could not load ${envPath}: ${e.message}`);
    }
  }
  return env;
}

const ownerEnv = loadOwnerEnv();

module.exports = {
  apps: [
    {
      name: 'repark-h5',
      // Canonical next CLI entry — survives npm/yarn version drift
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',

      // Working directory — must be the Next.js project root
      cwd: '/var/www/app',

      instances: 1,
      exec_mode: 'fork',

      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '1G',

      // Production env is the DEFAULT so `pm2 start` (without --env production)
      // also gets NODE_ENV=production. Without this, Next.js falls back to dev
      // mode and skips static asset generation → 400 on /_next/static/*.
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        ...ownerEnv,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: '3000',
        ...ownerEnv,
      },

      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/root/.pm2/logs/repark-h5-error.log',
      out_file: '/root/.pm2/logs/repark-h5-out.log',
      log_type: 'json',

      kill_timeout: 5000,
      wait_ready: true,
    },
  ],
};
