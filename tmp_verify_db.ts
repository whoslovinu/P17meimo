import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load env
const envPath = '/var/www/app/.env.production';
const env = fs.readFileSync(envPath, 'utf8');
for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.PG_URL,
    ssl: false,
});

(async () => {
    try {
        const r = await pool.query(
            `SELECT user_id, milestone_id, is_claimed, is_locked, admin_bypass, claimed_at
               FROM public.milestone_rewards
              WHERE user_id = '6c61704f-9bf3-5251-ba56-032e2561d8ee'
                AND milestone_id = '1789426260'`,
        );
        console.log('m1789426260 row:', JSON.stringify(r.rows[0] ?? null, null, 2));

        const r2 = await pool.query(
            `SELECT milestone_id, is_claimed, is_locked, admin_bypass
               FROM public.milestone_rewards
              WHERE user_id = '6c61704f-9bf3-5251-ba56-032e2561d8ee'
                AND activity_id = 1
              ORDER BY milestone_id::bigint`,
        );
        console.log('all rows:', JSON.stringify(r2.rows, null, 2));
    } catch (e: any) {
        console.error('Query failed:', e?.message);
    } finally {
        await pool.end();
    }
})();
