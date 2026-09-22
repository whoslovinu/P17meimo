// scripts/seed-test-user.mjs — Creates the test user UUID and a starting inventory
import pg from 'pg';

const PG_URL = process.env.DATABASE_URL || 'postgresql://postgres:PhbcRcx5Wt@127.0.0.1:5433/postgres';
const USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const c = new pg.Client({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query(
  `INSERT INTO public.users (id, email, nickname, avatar, total_damage_dealt)
   VALUES ($1, 'test@manual.local', '测试玩家', '🐱', 0)
   ON CONFLICT (id) DO NOTHING`,
  [USER_ID]
);
console.log(`✓ user ${USER_ID} ready`);

await c.query(
  `INSERT INTO public.user_inventory (user_id, item_hand_count, item_phallus_count)
   VALUES ($1, 100, 5)
   ON CONFLICT (user_id) DO UPDATE SET
     item_hand_count = EXCLUDED.item_hand_count,
     item_phallus_count = EXCLUDED.item_phallus_count,
     updated_at = NOW()`,
  [USER_ID]
);
console.log(`✓ inventory: 100 hand + 5 phallus`);

const r = await c.query(`SELECT * FROM public.users WHERE id = $1`, [USER_ID]);
console.log(`User row: ${JSON.stringify(r.rows[0])}`);

await c.end();
console.log(`\nUse this UID in your attacks: ${USER_ID}`);