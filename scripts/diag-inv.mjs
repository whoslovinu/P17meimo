import pg from 'pg';
const c = new pg.Client({
  connectionString: 'postgresql://postgres:PhbcRcx5Wt@127.0.0.1:5433/postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 6000,
});
await c.connect();
const r = await c.query(
  `SELECT user_id, item_hand_count, item_phallus_count, total_damage_dealt
     FROM public.user_inventory
    WHERE item_hand_count > 0 OR item_phallus_count > 0
    ORDER BY (item_hand_count + item_phallus_count) DESC
    LIMIT 10`,
);
console.log(r.rows);
await c.end();