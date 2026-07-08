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
const GKEY = readEnv("GEMINI_API_KEY");
const TG_TOKEN = readEnv("TELEGRAM_BOT_TOKEN"), TG_CHAT = readEnv("TELEGRAM_CHAT_ID");
if (!USER || !PASS || !DB) { console.error("missing SMTP_USER/SMTP_PASS/DATABASE_URL in .env.local"); process.exit(1); }

async function tg(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try { await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "HTML" }) }); } catch { /* best-effort */ }
}
// Draft a warm reply FROM JOE to an inbound message (Gemini text). Returns text or null.
async function geminiDraft(lead, inbound) {
  if (!GKEY) return null;
  const prompt = `You are Joe Sardella, founder of ThinkBigJoe (a web-design studio). You emailed the owner of "${lead.business_name}" offering a website you already built for them (live at ${lead.live_url || "a preview"}${lead.claim_code ? `, claim code ${lead.claim_code}` : ""}). They just REPLIED:\n\n"""${(inbound || "").slice(0, 1500)}"""\n\nWrite a short, warm, HUMAN reply FROM JOE — first person, 2-4 sentences, matching their tone. If they seem interested, nudge toward a quick 10-minute call or claiming the site. If they asked something, answer briefly and helpfully. Never pushy, no hype. Output ONLY the email body (no subject line). Sign off as "Joe".`;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GKEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    const j = await r.json();
    return j?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("").trim() || null;
  } catch { return null; }
}

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
  "select id, business_name, lower(email) email, live_url, claim_code from forge_sites where email is not null and outreach_status is not null",
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
          const hit = leads.find((l) => l.email && body.includes(l.email));
          if (hit) {
            const already = (await db.query("select 1 from forge_sites where id=$1 and outreach_status='bounced'", [hit.id])).rowCount > 0;
            // Retire the dead address: stash it in contact_notes for the record, then NULL email so the
            // lead re-enters the research agent's hunt (list_forge_needs_contact selects email-less leads).
            // outreach_status='bounced' is the "scanning for new contact" flag shown in the call room; it
            // flips back to sendable once enrich_forge_contact finds a new email or social channel.
            await db.query(
              `update forge_sites
                 set outreach_status='bounced',
                     contact_notes = coalesce(contact_notes || E'\\n', '') || $2,
                     email = null,
                     contact_enriched_at = null,
                     updated_at = now()
               where id=$1 and coalesce(outreach_status,'')<>'bounced'`,
              [hit.id, `⚠️ Email bounced ${new Date().toISOString().slice(0, 10)}: ${hit.email} — dead address, find a NEW email or a social (IG/FB/LinkedIn).`],
            );
            await logAct("email_bounced", `Bounced — ${hit.business_name} <${hit.email}> (address retired · handed to research for a new email/social)`, { siteId: hit.id, address: hit.email, subject: subject.slice(0, 140) });
            if (!already) await tg(`⚠️ <b>Email bounced</b> — ${hit.business_name} &lt;${hit.email}&gt;\nDead address retired (won't resend). Handed to the research agent to find a NEW email or a social profile.`);
          } else {
            await logAct("email_bounced", `Bounce received (couldn't match to a lead) — "${subject.slice(0, 80)}"`, { from, subject: subject.slice(0, 140) });
          }
          bounces++;
          continue;
        }
        const lead = byEmail.get(from);
        if (lead) {
          const cleanBody = (parsed.text || "").replace(/\s+/g, " ").trim();
          await logAct("email_reply", `Reply from ${lead.business_name} <${from}>`, { siteId: lead.id, from, subject: subject.slice(0, 140), snippet: cleanBody.slice(0, 300) });
          // Prepare a draft response (draft → Joe approves → send). One row per inbound msg (UID watermark dedupes).
          const draft = await geminiDraft(lead, parsed.text || subject);
          const ins = await db.query(
            `insert into forge_replies (site_id, from_email, subject, inbound_text, draft, status)
             values ($1,$2,$3,$4,$5,'awaiting') returning id`,
            [lead.id, from, subject.slice(0, 200), cleanBody.slice(0, 4000), draft],
          );
          await tg(`↩️ <b>Reply</b> from ${lead.business_name} &lt;${from}&gt;\n"${cleanBody.slice(0, 160)}"\n\n${draft ? "✍️ A draft response is ready for your review" : "⚠️ Couldn't auto-draft — write one"} → command/leads (reply #${ins.rows[0].id}).`);
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
