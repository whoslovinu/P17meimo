import pg from 'pg';

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:YOUR_DATABASE_PASSWORD@127.0.0.1:5433/postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 6000,
});
await c.connect();

for (const t of ['users', 'user_inventory', 'boss_status', 'attack_logs']) {
  const cols = await c.query(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [t],
  );
  console.log(
    `TABLE ${t}:`,
    cols.rows
      .map(
        (r) =>
          `${r.column_name} ${r.data_type}${r.is_nullable === 'NO' ? ' NOT NULL' : ''}${r.column_default ? ' DEFAULT ' + r.column_default : ''}`,
      )
      .join(', '),
  );
}

const chk = await c.query(
  `SELECT conname, pg_get_constraintdef(oid) AS def
     FROM pg_constraint
    WHERE conrelid = 'public.user_inventory'::regclass AND contype = 'c'`,
);
console.log('CHECKS user_inventory:', chk.rows);

const en = await c.query(
  `SELECT t.typname, e.enumlabel
     FROM pg_type t
     JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname IN ('inventory_status', 'user_status', 'attack_item_type', 'activity_status')`,
);
console.log('ENUMS:', en.rows);

const fk = await c.query(
  `SELECT conname, conrelid::regclass AS tbl, pg_get_constraintdef(oid) AS def
     FROM pg_constraint
    WHERE conrelid IN ('public.attack_logs'::regclass, 'public.user_inventory'::regclass, 'public.boss_status'::regclass)
      AND contype = 'f'`,
);
console.log('FKs:', fk.rows);

await c.end();
