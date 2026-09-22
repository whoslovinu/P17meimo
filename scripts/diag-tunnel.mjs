// scripts/diag-tunnel.mjs — directly probe Redis and PG through the tunnel
import { default as Redis } from 'ioredis';
import pg from 'pg';

const REDIS_URL = process.env.REDIS_URL || 'rediss://127.0.0.1:6380';
const PG_URL = process.env.DATABASE_URL || 'postgresql://postgres:PhbcRcx5Wt@127.0.0.1:5433/postgres';

async function testRedis() {
  console.log('--- Redis ---');
  console.log('URL:', REDIS_URL);
  const c = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    tls: REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    lazyConnect: true,
  });
  c.on('error', (e) => console.log('  [error event]', e.message));
  try {
    await c.connect();
    const pong = await c.ping();
    console.log('  PING →', pong);
    await c.set('diag:test', 'ok', 'EX', 5);
    const v = await c.get('diag:test');
    console.log('  GET diag:test →', v);
    await c.del('diag:test');
    c.disconnect();
    console.log('  RESULT: UP');
  } catch (e) {
    console.log('  RESULT: DOWN —', e.message);
    try { c.disconnect(); } catch {}
    process.exitCode = 1;
  }
}

async function testPG() {
  console.log('\n--- PostgreSQL ---');
  console.log('URL:', PG_URL);
  const c = new pg.Client({
    connectionString: PG_URL,
    connectionTimeoutMillis: 5000,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await c.connect();
    const r = await c.query('SELECT 1 AS ok, version()');
    console.log('  SELECT 1 →', r.rows[0].ok);
    console.log('  Version:', r.rows[0].version.substring(0, 60));
    await c.end();
    console.log('  RESULT: UP');
  } catch (e) {
    console.log('  RESULT: DOWN —', e.message);
    process.exitCode = 1;
  }
}

await testRedis();
await testPG();
console.log('\nDone. exitCode =', process.exitCode || 0);
