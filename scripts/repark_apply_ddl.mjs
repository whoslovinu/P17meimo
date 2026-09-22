// REPARK 7.0 — apply multi-statement DDL against the live RDS tunnel.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const url = process.env.DATABASE_URL || 'postgresql://postgres:PhbcRcx5Wt@127.0.0.1:5433/postgres';

const fileFlag = process.argv.find((a) => a.startsWith('--file='));
if (!fileFlag) {
  console.error('Usage: node repark_apply_ddl.mjs --file=<path>');
  process.exit(2);
}
const sqlPath = path.resolve(fileFlag.slice('--file='.length));
const sql = fs.readFileSync(sqlPath, 'utf8');

(async () => {
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const res = await client.query(sql);
    console.log(JSON.stringify({ ok: true, statements: res, file: path.basename(sqlPath) }));
  } catch (err) {
    console.error('DDL_ERROR:', err.message);
    process.exit(3);
  } finally {
    await client.end();
  }
})();