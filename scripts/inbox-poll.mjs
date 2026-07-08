#!/usr/bin/env node
// inbox-poll.mjs — watches joe@thinkbigjoe.com (Zoho IMAP) for outreach BOUNCES + REPLIES so the
// marketing/outreach agent never flies blind on delivery. Deterministic infra (no LLM); runs every
// ~10 min via launchd (com.thinkbigjoe.inboxpoll).
//
//   • Bounce (Mailer-Daemon / DSN naming a lead's address) → mark that lead outreach_status='bounced'
//     (so we stop emailing a dead address) + log `email_bounced`.
//   • Reply (From = a lead's address) → log `email_reply` with a snippet (follow-up signal).
//   • Always logs `inbox_checked` with a summary.
//
// IMAP login = the SAME Zoho creds as SMTP (SMTP_USER/SMTP_PASS). Reads them + DATABASE_URL_UNPOOLED
// from thinkbigjoe/.env.local. Never marks your mail as read (BODY.PEEK). Watermark in /tmp so each
// message is processed once.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import pg from "pg";

const ENVF = path.join(process.env.HOME, "code/thinkbigjoe/.env.local");
const readEnv = (k) => {
  const m = readFileSync(ENVF, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};
const USER = readEnv("SMTP_USER"), PASS = readEnv("SMTP_PASS");
const DB = readEnv("DATABASE_URL_UNPOOLED") || readEnv("DATABASE_URL");
if (!USER || !PASS || !DB) { console.error("missing SMTP_USER/SMTP_PASS/DATABASE_URL in .env.local"); process.exit(1); }

const STATE = "/tmp/tbj-inbox-poll.uid";
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

const db = new pg.Client({ connectionString: DB });
await db.connect();
async function logAct(eventType, summary, detail) {
  try {
    await db.query(
      "insert into activity_log (actor,event_type,summary,metadata,created_at) values ('inbox',$1,$2,$3,now())",
      [eventType, summary, JSON.stringify(detail ? { detail } : {})],
    );
  } catch (e) { log("activity log failed:", e.message); }
}

// Our outreach recipients → for matching bounces (address in DSN body) + replies (From = lead).
const leads = (await db.query(
  "select id, business_name, lower(email) email from forge_sites where email is not null and outreach_status is not null",
)).rows;
const byEmail = new Map(leads.map((l) => [l.email, l]));

const client = new ImapFlow({ host: "imap.zoho.com", port: 993, secure: true, auth: { user: USER, pass: PASS }, logger: false });
let bounces = 0, replies = 0, scanned = 0;
try {
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const uidNext = client.mailbox.uidNext; // watermark for NEXT run
    const last = existsSync(STATE) ? parseInt(readFileSync(STATE, "utf8").trim(), 10) || 0 : 0;
    let uids = last > 0
      ? await client.search({ uid: `${last}:*` }, { uid: true })
      : await client.search({ since: new Date(Date.now() - 2 * 864e5) }, { uid: true }); // first run: last 2 days
    uids = (uids || []).filter((u) => u >= last).slice(-300); // cap per run
    if (uids.length) {
      for await (const msg of client.fetch(uids, { source: true, envelope: true }, { uid: true })) {
        scanned++;
        let parsed;
        try { parsed = await simpleParser(msg.source); } catch { continue; }
        const from = (parsed.from?.value?.[0]?.address || "").toLowerCase();
        const subject = parsed.subject || "";
        const body = `${parsed.text || ""} ${parsed.html || ""}`.toLowerCase();

        const looksBounce =
          /mailer-daemon|postmaster|mail delivery (sub)?system|delivery[- ]status|no-?reply.*(mail|deliver)/i.test(from) ||
          /undeliver|delivery (status notification|has failed|failure)|failure notice|returned mail|couldn.t be delivered|wasn.t delivered|address not found|recipient.*not found/i.test(subject);

        if (looksBounce) {
          const hit = leads.find((l) => body.includes(l.email));
          if (hit) {
            await db.query("update forge_sites set outreach_status='bounced', updated_at=now() where id=$1 and coalesce(outreach_status,'')<>'bounced'", [hit.id]);
            await logAct("email_bounced", `Bounced — ${hit.business_name} <${hit.email}>`, { siteId: hit.id, address: hit.email, subject: subject.slice(0, 140) });
          } else {
            await logAct("email_bounced", `Bounce received (couldn't match to a lead) — "${subject.slice(0, 80)}"`, { from, subject: subject.slice(0, 140) });
          }
          bounces++;
          continue;
        }
        const lead = byEmail.get(from);
        if (lead) {
          await logAct("email_reply", `Reply from ${lead.business_name} <${from}>`, { siteId: lead.id, from, subject: subject.slice(0, 140), snippet: (parsed.text || "").replace(/\s+/g, " ").slice(0, 300) });
          replies++;
        }
      }
    }
    writeFileSync(STATE, String(uidNext));
  } finally { lock.release(); }
  await client.logout();
} catch (e) {
  log("inbox poll error:", e.message);
  await logAct("inbox_checked", `Inbox check FAILED: ${e.message}`.slice(0, 160), { error: e.message });
  await db.end(); process.exit(0);
}

await logAct("inbox_checked", `Inbox scan — ${scanned} new msg(s) · ${bounces} bounce(s) · ${replies} reply(ies)`, { scanned, bounces, replies });
log(`done — scanned ${scanned}, ${bounces} bounces, ${replies} replies`);
await db.end();
