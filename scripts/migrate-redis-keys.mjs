// scripts/migrate-redis-keys.mjs — moves old keys to new hash-tagged keys
import { default as Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'rediss://127.0.0.1:6380';
const r = new Redis(REDIS_URL, {
  tls: REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
  lazyConnect: true,
});
await r.connect();

const OLD_TO_NEW = [
  ['boss:hp',          '{battle}:boss:hp'],
  ['boss:max_hp',      '{battle}:boss:max_hp'],
  ['boss:version',     '{battle}:boss:version'],
];

for (const [oldKey, newKey] of OLD_TO_NEW) {
  const val = await r.get(oldKey);
  if (val !== null) {
    await r.set(newKey, val);
    await r.del(oldKey);
    console.log(`  ${oldKey} → ${newKey} = ${val}`);
  } else {
    console.log(`  ${oldKey}: (no value, skipping)`);
  }
}

// Also: rate:{userId} → {battle}:rate:{userId}
const oldRateKeys = await r.keys('rate:*');
console.log(`  rate:* found: ${oldRateKeys.length}`);
for (const oldKey of oldRateKeys) {
  const userId = oldKey.slice('rate:'.length);
  const val = await r.get(oldKey);
  if (val !== null) {
    await r.set(`{battle}:rate:${userId}`, val);
    await r.del(oldKey);
    console.log(`  ${oldKey} → {battle}:rate:${userId}`);
  }
}

const oldIdemKeys = await r.keys('idempotency:*');
console.log(`  idempotency:* found: ${oldIdemKeys.length}`);
for (const oldKey of oldIdemKeys) {
  const val = await r.get(oldKey);
  if (val !== null) {
    await r.rename(oldKey, oldKey.replace('idempotency:', '{battle}:idempotency:'));
  }
}

console.log('\nNew keys in DB:');
const allNew = await r.keys('{battle}:*');
for (const k of allNew) console.log('  -', k, '=', await r.get(k));

r.disconnect();
console.log('\nDone.');