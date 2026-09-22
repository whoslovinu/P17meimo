// Lightweight CLI for running SELECT/DDL against the live RDS tunnel.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;

const url =
  process.env.DATABASE_URL ||
  'postgresql://postgres:PhbcRcx5Wt@127.0.0.1:5433/postgres';

function getSql() {
  const fileFlag = process.argv.find((a) => a.startsWith('--file='));
  if (fileFlag) {
    return fs.readFileSync(fileFlag.slice('--file='.length), 'utf8');
  }
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  return args.join(' ');
}

async function main() {
  const sql = getSql();
  if (!sql) {
    console.error('No SQL provided');
    process.exit(1);
  }
  const useSsl = process.env.SQL_SSL !== '0';
  const client = new Client({ connectionString: url, ssl: useSsl ? { rejectUnauthorized: false } : false });
  await client.connect();
  try {
    const res = await client.query(sql);
    const out = { ok: true, rows: [], rowCount: 0 };
    if (Array.isArray(res)) {
      for (const r of res) {
        if (r.rows && r.rows.length) out.rows.push(...r.rows);
        out.rowCount += r.rowCount ?? 0;
      }
    } else {
      if (res.rows && res.rows.length) out.rows = res.rows;
      out.rowCount = res.rowCount ?? 0;
    }
    fs.writeFileSync(path.join(os.tmpdir(), 'repark_sql_out.json'), JSON.stringify(out));
    console.log(JSON.stringify(out));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('SQL_ERROR:', err.message);
  process.exit(2);
});
