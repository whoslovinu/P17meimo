const {Client}=require('pg');
const c=new Client({host:'127.0.0.1',port:5433,user:'postgres',password:'YOUR_DATABASE_PASSWORD',database:'postgres',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:8000});
const uuid='48573483-01ef-4615-a6b5-8a5b6ceeff76';
c.connect().then(async()=>{
  try{
    const s=await c.query("SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name='user_daily_tasks' ORDER BY ordinal_position");
    console.log('user_daily_tasks schema:', JSON.stringify(s.rows,null,2));
    // Test: does the query return correct value?
    const t=await c.query("SELECT daily_energy_consumed FROM public.user_daily_tasks WHERE user_id=$1",[uuid]);
    console.log('SELECT result:', t.rows);
    const t2=await c.query("UPDATE public.user_daily_tasks SET daily_energy_consumed=daily_energy_consumed+50 WHERE user_id=$1 RETURNING daily_energy_consumed",[uuid]);
    console.log('UPDATE RETURNING:', t2.rows);
  }catch(e){console.log('FAIL:',e.message);}
  c.end();
}).catch(e=>console.log('connect FAIL:',e.message));
