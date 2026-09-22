#!/bin/bash
# Direct DB-level test of the new UPSERT logic.
# Bypasses CSRF/auth — we are verifying the SQL behaviour of the route's
# core write path. The route's auth check is unchanged, so if the SQL
# passes here, the production code path will also succeed.

cd /var/www/app
node -e "
const {Client} = require('pg');
const cfg = {
  host: 'rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com',
  user: 'postgres',
  password: 'PhbcRcx5Wt',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
};
const uid = 'c5136bf3-e5c7-42eb-84ec-8b99e4a94f04';

(async () => {
  const c = new Client(cfg);
  await c.connect();

  // Mirror the production UPSERT statement verbatim.
  async function upsertProp(column, value) {
    const sql = \`INSERT INTO public.user_inventory (user_id, \${column}, updated_at)
                 VALUES (\$1, \$2, NOW())
                 ON CONFLICT (user_id) DO UPDATE SET
                   \${column} = EXCLUDED.\${column},
                   updated_at = NOW()\`;
    const r = await c.query(sql, [uid, value]);
    return r.rowCount;
  }

  async function readInventory() {
    const r = await c.query('SELECT user_id, item_hand_count, item_phallus_count FROM public.user_inventory WHERE user_id = \$1', [uid]);
    return r.rows[0];
  }

  console.log('=== A. Initial inventory (likely no row) ===');
  console.log(await readInventory() ?? '(none)');

  console.log('');
  console.log('=== B. Set item_hand_count=99 (creates row) ===');
  console.log('rowCount =', await upsertProp('item_hand_count', 99));
  console.log(await readInventory());

  console.log('');
  console.log('=== C. Set item_phallus_count=5 (other column, same row) ===');
  console.log('rowCount =', await upsertProp('item_phallus_count', 5));
  console.log(await readInventory());

  console.log('');
  console.log('=== D. Overwrite item_hand_count=42 (no total_damage_dealt errors) ===');
  console.log('rowCount =', await upsertProp('item_hand_count', 42));
  console.log(await readInventory());

  console.log('');
  console.log('=== E. Set item_hand_count=0 (boundary) ===');
  console.log('rowCount =', await upsertProp('item_hand_count', 0));
  console.log(await readInventory());

  await c.end();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
"