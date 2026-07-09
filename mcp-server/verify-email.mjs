// Deterministic email deliverability check — runs where outbound port 25 is open (Joe's Mac /
// the MCP server), NOT on Vercel (serverless blocks port 25). Used by enrich_forge_contact so a
// guessed/dead address never enters the pipeline and bounces later. See docs/AUTH.md.
//
// verifyEmail(email) → { status, reason, role }
//   status: "valid"    — MX ok + the mailbox was accepted (and the domain is NOT catch-all)
//           "invalid"  — bad syntax, no MX, or the mail server rejected the mailbox (5xx)
//           "risky"    — accepted, but a role/generic address (info@, hello@…) — deliverable but low-trust
//           "unknown"  — couldn't determine (catch-all domain, greylist, timeout, probe blocked)
// Only "invalid" should be dropped; "unknown"/"risky" still send (with the bounce poller as backstop).
import { promises as dns } from "node:dns";
import net from "node:net";

const ROLE = new Set([
  "info", "hello", "contact", "office", "admin", "sales", "support", "team",
  "hi", "mail", "email", "enquiries", "inquiries", "help", "service", "billing",
]);

/** One SMTP conversation up to RCPT TO. Resolves { code } (0 = couldn't probe). Handles multi-line replies. */
function smtpProbe(host, rcpt, fromAddr, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const sock = net.createConnection(25, host);
    const finish = (code) => { if (done) return; done = true; try { sock.write("QUIT\r\n"); sock.destroy(); } catch { /* ignore */ } resolve({ code }); };
    sock.setTimeout(timeoutMs);
    sock.on("timeout", () => finish(0));
    sock.on("error", () => finish(0));

    let stage = 0, buf = "";
    const steps = [
      `HELO thinkbigjoe.com`,
      `MAIL FROM:<${fromAddr}>`,
      `RCPT TO:<${rcpt}>`,
    ];
    sock.on("data", (d) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        // Continuation line ("250-...") — wait for the final ("250 ...").
        if (/^\d{3}-/.test(line)) continue;
        const code = parseInt(line.slice(0, 3), 10) || 0;
        if (stage === 0) { if (code !== 220) return finish(code); }        // greeting
        else if (stage === 1) { /* HELO reply — proceed regardless */ }
        else if (stage === 2) { if (code >= 400) return finish(code); }    // MAIL FROM refused
        else if (stage === 3) { return finish(code); }                     // RCPT reply = the answer
        if (stage < steps.length) { sock.write(steps[stage] + "\r\n"); }
        stage++;
      }
    });
  });
}

export async function verifyEmail(email, { timeoutMs = 7000, fromAddr = "verify@thinkbigjoe.com" } = {}) {
  const e = String(email || "").trim().toLowerCase();
  const m = e.match(/^[^\s@]+@([^\s@]+\.[^\s@]+)$/);
  if (!m) return { status: "invalid", reason: "bad-syntax", role: false };
  const domain = m[1];
  const role = ROLE.has(e.split("@")[0]);

  // MX (fall back to A record — a domain can accept mail on its A record).
  let host;
  try {
    const mx = await dns.resolveMx(domain);
    if (mx?.length) host = mx.sort((a, b) => a.priority - b.priority)[0].exchange;
  } catch { /* fall through */ }
  if (!host) {
    try { await dns.resolve(domain); host = domain; } catch { return { status: "invalid", reason: "no-mx", role }; }
  }

  const real = await smtpProbe(host, e, fromAddr, timeoutMs);
  if (real.code === 0) return { status: "unknown", reason: "probe-blocked", role };
  if (real.code >= 500) return { status: "invalid", reason: "mailbox-rejected", role };
  if (real.code >= 400) return { status: "unknown", reason: "greylisted", role };

  // Accepted (2xx). Rule out a catch-all domain (accepts everything) before trusting it.
  const fake = `zzz-no-such-user-${Date.now().toString(36)}@${domain}`;
  const ca = await smtpProbe(host, fake, fromAddr, timeoutMs);
  if (ca.code >= 200 && ca.code < 300) return { status: "unknown", reason: "catch-all", role };
  return { status: role ? "risky" : "valid", reason: "accepted", role };
}
