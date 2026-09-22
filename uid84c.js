const {Pool}=require('pg');
const p=new Pool({connectionString:"postgresql://postgres:PhbcRcx5Wt@rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com:5432/postgres",ssl:{rejectUnauthorized:false}});
(async()=>{
  const r=await p.query("SELECT * FROM public.user_inventory WHERE user_id::text LIKE $1",["%0084%"]);
  console.log("user_inventory:",JSON.stringify(r.rows,null,2));
  const r2=await p.query("SELECT * FROM public.user_activity_stats WHERE user_id::text LIKE $1",["%0084%"]);
  console.log("user_activity_stats:",JSON.stringify(r2.rows,null,2));
  const r3=await p.query("SELECT * FROM public.milestone_rewards WHERE user_id::text LIKE $1",["%0084%"]);
  console.log("milestone_rewards:",JSON.stringify(r3.rows,null,2));
  await p.end();
})();
