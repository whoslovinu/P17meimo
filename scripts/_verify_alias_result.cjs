const {Client}=require('pg');
const c=new Client({host:'127.0.0.1',port:5433,user:'postgres',password:'YOUR_DATABASE_PASSWORD',database:'postgres',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:8000});
const uuid='48573483-01ef-4615-a6b5-8a5b6ceeff76';
c.connect().then(async()=>{
  try{
    const r=await c.query('SELECT user_id, daily_energy_consumed, daily_money_recharged, recharge_processed FROM public.user_daily_tasks WHERE user_id=$1',[uuid]);
    console.log('user_daily_tasks:', r.rows.length, JSON.stringify(r.rows));
    const r2=await c.query('SELECT user_id, task_type, reset_date, current_progress, is_claimed FROM public.task_progress WHERE user_id=$1',[uuid]);
    console.log('task_progress:', r2.rows.length, JSON.stringify(r2.rows));
    const r3=await c.query('SELECT alias_value, uuid, created_at FROM public.user_alias WHERE uuid=$1',[uuid]);
    console.log('user_alias:', r3.rows.length, JSON.stringify(r3.rows));
  }catch(e){console.log('FAIL:', e.message);}
  c.end();
}).catch(e=>console.log('connect FAIL:', e.message));
