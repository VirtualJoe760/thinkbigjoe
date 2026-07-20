import { readFileSync } from 'fs';
import pg from 'pg';
const url=(readFileSync('.env.local','utf8').match(/^DATABASE_URL=(.*)$/m)||[])[1].trim().replace(/^["']|["']$/g,'');
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}});
await c.connect();
const {rows:[s]} = await c.query(`select id,business_name,plan,subscription_status,paid_at from forge_sites where status='built' order by id limit 1`);
await c.query(`update forge_sites set plan='voice', subscription_status='active', paid_at=now() - interval '10 days' where id=$1`,[s.id]);
await c.query(`delete from calls where retell_call_id like 'warn_%'`);
// 420 minutes against a 400 allowance = 20 over
for (let i=0;i<42;i++){
  await c.query(`insert into calls (site_id,retell_call_id,to_number,started_at,duration_sec,disposition)
    values ($1,$2,'+14805550199', now() - interval '2 days', 600, 'message')`,[s.id,'warn_'+i]);
}
console.log(JSON.stringify({siteId:s.id,name:s.business_name,seeded:'42 calls x 10min = 420 min vs 400 allowance'}));
await c.end();
