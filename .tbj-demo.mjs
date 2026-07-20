import { readFileSync } from 'fs';
import pg from 'pg';
const url=(readFileSync('.env.local','utf8').match(/^DATABASE_URL=(.*)$/m)||[])[1].trim().replace(/^["']|["']$/g,'');
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}});
await c.connect();
const SITE=723, LINE='+14805550199';
// Sunrise Plumbing — claimed, on the voice plan, fully configured
await c.query(`update forge_sites set plan='voice', subscription_status='active', one_time_paid=true,
  paid_at=now()-interval '12 days', booking_timezone='America/Phoenix', receptionist_config=$1 where id=$2`,
  [JSON.stringify({
    greeting:"Thanks for calling Sunrise Plumbing and Drain — what's going on?",
    services:"Drain cleaning, leak detection, water heaters, burst pipes. No septic or well pumps.",
    serviceArea:"Phoenix metro", hours:"Mon-Fri 7am-5pm, emergencies 24/7",
    emergencyDefinition:"Flooding, burst pipe, sewage backup, or any smell of gas.",
    notifyPhone:"+14805550177", escalationPhone:"+14805550143",
    doNot:"Never quote a firm price. Never promise same-day.",
    faqs:"Licensed & insured? — Yes, Arizona licensed and bonded.",
    bookingMode:"message",
  }), SITE]);
await c.query(`delete from voice_lines where phone_number=$1`,[LINE]);
await c.query(`insert into voice_lines (phone_number,site_id,status) values ($1,$2,'active')`,[LINE,SITE]);
await c.query(`delete from calls where site_id=$1`,[SITE]);
// A believable fortnight: 18 calls, mostly after-hours, one emergency, one wrong number
const rows=[
 ["Dave Restrepo","+16025551201","Water heater burst, flooding the garage","emergency",true,412,1],
 ["Maria Chen","+16025551202","Kitchen sink backing up","routine",true,168,1],
 ["Tom Blakely","+16025551203","Wants a quote on repiping","routine",true,204,2],
 ["","+18885550100","Robocall about auto warranty","routine",false,22,2],
 ["Priya Nadar","+16025551205","No hot water since this morning","urgent",true,190,3],
 ["Frank Oduya","+16025551206","Toilet running constantly","routine",true,143,4],
 ["Sam Whitlock","+16025551207","Sewage smell in the basement","emergency",true,377,5],
 ["Dana Reyes","+16025551208","Wants to schedule a drain cleaning","routine",true,155,6],
];
for (let i=0;i<rows.length;i++){
  const [name,from,problem,urg,real,dur,daysAgo]=rows[i];
  await c.query(`insert into calls (site_id,retell_call_id,from_number,to_number,started_at,ended_at,
    duration_sec,caller_name,callback_number,problem,urgency,is_real_lead,disposition,summary,notified_at)
    values ($1,$2,$3,$4, now()-($5||' days')::interval, now()-($5||' days')::interval + ($6::text||' seconds')::interval,
    $6::int,$7,$3,$8,$9,$10,'message',$11, case when $10 then now()-($5||' days')::interval else null end)`,
    [SITE,'demo_'+i,from,LINE,String(daysAgo),dur,name,problem,urg,real,
     real?`Caller reported: ${problem}. Details taken, owner notified.`:'Automated sales call, no action needed.']);
}
const {rows:[s]} = await c.query(`select business_name, slug from forge_sites where id=$1`,[SITE]);
const {rows:[agg]} = await c.query(`select count(*)::int n, sum(duration_sec)::int secs from calls where site_id=$1`,[SITE]);
console.log(JSON.stringify({site:s.business_name,slug:s.slug,line:LINE,calls:agg.n,minutes:Math.floor(agg.secs/60)}));
await c.end();
