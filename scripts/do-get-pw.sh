#!/bin/bash
echo '--- redis admin password ---'
redis-cli --no-auth-warning -n 1 GET 'repark:admin:password_hash' 2>&1 || echo 'NOT_IN_REDIS'
redis-cli --no-auth-warning -n 1 KEYS 'repark:admin:*' 2>&1 || echo 'NO_REDIS_KEYS'
echo '--- try postgres via node ---'
cd /var/www/app
node -e "
const { getPostgresPool } = require('./lib/db/postgres');
async function main() {
  try {
    const pool = getPostgresPool();
    const res = await pool.query(\"SELECT key, LEFT(value, 40) FROM config WHERE key LIKE '%admin%' LIMIT 5\");
    console.log(JSON.stringify(res.rows));
    await pool.end();
  } catch(e) {
    console.error('DB_ERROR:', e.message);
  }
}
main();
" 2>&1 | head -20
