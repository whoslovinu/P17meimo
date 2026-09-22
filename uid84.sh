#!/bin/bash
echo '=== UID84 actual DB state ==='
cd /var/www/app
node -e "
const {Pool} = require('pg');
const pool = new Pool({connectionString: 'postgresql://postgres:PhbcRcx5Wt@rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com:5432/postgres', ssl: {rejectUnauthorized: false}});
(async () => {
  const r = await pool.query(\"SELECT user_id, total_damage_dealt FROM public.user_inventory WHERE user_id = 'uid84' LIMIT 5\");
  console.log('user_inventory:', JSON.stringify(r.rows, null, 2));

  const r2 = await pool.query(\"SELECT user_id, activity_id, personal_damage FROM public.user_activity_stats WHERE user_id = 'uid84' LIMIT 5\");
  console.log('user_activity_stats:', JSON.stringify(r2.rows, null, 2));

  const r3 = await pool.query(\"SELECT user_id, milestone_id, is_claimed, is_locked, admin_bypass FROM public.milestone_rewards WHERE user_id = 'uid84'\");
  console.log('milestone_rewards:', JSON.stringify(r3.rows, null, 2));
  await pool.end();
})();
" 2>&1 | head -100
