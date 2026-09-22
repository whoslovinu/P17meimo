// scripts/fix-activity-flag.mjs — sets isGlobalEnabled=true on activity id=1
import pg from 'pg';

const PG_URL = process.env.DATABASE_URL || 'postgresql://postgres:PhbcRcx5Wt@127.0.0.1:5433/postgres';

const c = new pg.Client({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(
  `UPDATE public.activities
     SET config = jsonb_set(config, '{isGlobalEnabled}', 'true'::jsonb, true),
         status = 'ENABLED'
   WHERE id = 1
   RETURNING id, name, status, config`
);
console.log('Updated:', JSON.stringify(r.rows, null, 2));
await c.end();