#!/usr/bin/env node
// email-outbox-drain.mjs — fires APPROVED, DUE scheduled sends from email_outbox over Zoho SMTP.
// Deterministic infra (no LLM): Edward queues sends, Venus approves; immediate approvals are sent
// by the email_approve_send tool itself — this drain exists ONLY for future-dated (send_at) rows.
// Runs every 5 min via launchd (com.thinkbigjoe.emailoutboxdrain). No-ops on an empty queue.
// Sends as Joe (SMTP_USER) — 1:1 personal correspondence, never bulk (see docs/DELIVERABILITY.md).
import { readFileSync } from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import pg from "pg";

const ENVF = path.join(process.env.HOME, "code/thinkbigjoe/.env.local");
const readEnv = (k) => {
  const m = readFileSync(ENVF, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};
const USER = readEnv("SMTP_USER"), PASS = readEnv("SMTP_PASS");
const DB = readEnv("DATABASE_URL_UNPOOLED") || readEnv("DATABASE_URL");
if (!USER || !PASS || !DB) { console.error("missing SMTP_USER/SMTP_PASS/DATABASE_URL in .env.local"); process.exit(1); }

const pool = new pg.Pool({ connectionString: DB, ssl: { rejectUnauthorized: false }, max: 1 });
const mailer = nodemailer.createTransport({ host: "smtp.zoho.com", port: 465, secure: true, auth: { user: USER, pass: PASS } });

const due = await pool.query(
  `SELECT * FROM email_outbox WHERE status = 'approved' AND send_at IS NOT NULL AND send_at <= now() ORDER BY send_at LIMIT 10`,
);
for (const row of due.rows) {
  try {
    await mailer.sendMail({
      from: `Joe Sardella <${USER}>`,
      to: row.to_addr,
      cc: row.cc_addr || undefined,
      subject: row.subject,
      text: row.body,
      inReplyTo: row.in_reply_to || undefined,
      references: row.in_reply_to || undefined,
    });
    await pool.query(`UPDATE email_outbox SET status = 'sent', sent_at = now() WHERE id = $1`, [row.id]);
    await pool.query(
      `INSERT INTO activity_log (actor, event_type, summary, metadata) VALUES ('venus', 'email_sent', $1, $2::jsonb)`,
      [`Outbox #${row.id} (scheduled) sent to ${row.to_addr}: ${row.subject}`, JSON.stringify({ auto: true, id: row.id })],
    );
    console.log(`sent #${row.id} → ${row.to_addr}`);
  } catch (err) {
    const msg = String(err?.message || err);
    await pool.query(`UPDATE email_outbox SET status = 'failed', error = $2 WHERE id = $1`, [row.id, msg]);
    console.error(`FAILED #${row.id} → ${row.to_addr}: ${msg}`);
  }
}
if (!due.rows.length) console.log("outbox drain: nothing due");
await pool.end();
