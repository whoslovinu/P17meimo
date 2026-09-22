#!/bin/bash
echo "=== Check REDIS_URL ==="
sudo cat /var/www/app/.env.production 2>/dev/null | grep -E "REDIS" | head -5
echo ""
echo "=== Test redis connectivity from app context ==="
sudo -E env PATH=$PATH /var/www/app/node_modules/.bin/redis-cli -h 127.0.0.1 ping 2>&1 || echo "no local redis"
echo ""
echo "=== Test redis via ioredis (sample query from app perspective) ==="
cat > /tmp/redis_test.js << 'EOF'
const Redis = require('/var/www/app/node_modules/ioredis');
const client = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  lazyConnect: true,
  tls: (process.env.REDIS_TLS === 'true' || (process.env.REDIS_URL||'').startsWith('rediss://'))
    ? { rejectUnauthorized: false } : undefined,
});
client.connect().then(async () => {
  console.log('PING:', await client.ping());
  console.log('Test SETNX:', await client.set('test_lock_128', '1', 'EX', 5, 'NX'));
  await client.del('test_lock_128');
  client.disconnect();
}).catch(e => {
  console.log('ERROR:', e.message);
  process.exit(1);
});
EOF
sudo -E env NODE_ENV=production $(grep -v '^#' /var/www/app/.env.production | xargs) node /tmp/redis_test.js 2>&1 | head -5