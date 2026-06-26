import nodemailer from "nodemailer";

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT || 587);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;

const isConfigured = Boolean(host && user && pass);

// Built once per server instance. Null until SMTP env vars are provided so the
// app (and signups) never break in environments without email configured.
const transporter = isConfigured
  ? nodemailer.createTransport({
      host,
      port,
      // 465 = implicit TLS; 587/25 = STARTTLS. Override with SMTP_SECURE=true/false.
      secure: process.env.SMTP_SECURE
        ? process.env.SMTP_SECURE === "true"
        : port === 465,
      auth: { user, pass },
    })
  : null;

// Transactional emails always send from the brand no-reply address.
const FROM = process.env.EMAIL_FROM || "ThinkBigJoe <no-reply@thinkbigjoe.com>";

// Forward a copy of every transactional email here (admin visibility).
const BCC = process.env.EMAIL_BCC;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com";
const BRAND = "#2f6bff";

type SendArgs = {
  to: string | string[];
  subject: string;
  html: string;
};

/**
 * Low-level send via SMTP (Nodemailer). No-ops (with a warning) when SMTP env
 * vars are unset so signups and other flows never break without email set up.
 */
export async function sendEmail({ to, subject, html }: SendArgs) {
  if (!transporter) {
    console.warn(
      `[email] SMTP not configured — skipping "${subject}" to ${Array.isArray(to) ? to.join(", ") : to}`,
    );
    return { skipped: true as const };
  }
  try {
    const info = await transporter.sendMail({
      from: FROM,
      to,
      subject,
      html,
      ...(BCC ? { bcc: BCC } : {}),
    });
    return { data: info };
  } catch (err) {
    console.error("[email] send failed:", err);
    return { error: err };
  }
}

/** Branded HTML shell shared by all transactional emails. */
function layout(bodyHtml: string) {
  return `
  <div style="margin:0;padding:0;background:#f5f7fb;font-family:Helvetica,Arial,sans-serif;color:#0a0a0b;">
    <div style="max-width:520px;margin:0 auto;padding:40px 24px;">
      <div style="font-size:22px;font-weight:700;letter-spacing:-0.3px;">
        think<span style="color:${BRAND};">big</span>joe
      </div>
      <div style="margin-top:24px;background:#ffffff;border:1px solid #e6e9ef;border-radius:16px;padding:32px;">
        ${bodyHtml}
      </div>
      <p style="margin-top:24px;font-size:12px;color:#9aa0ad;text-align:center;">
        ThinkBigJoe · Agentic AI &amp; MCP development<br/>
        This is a no-reply message — please don't reply to this email.
      </p>
    </div>
  </div>`;
}

function button(href: string, label: string) {
  return `<a href="${href}" style="display:inline-block;margin-top:24px;background:${BRAND};color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px;">${label}</a>`;
}

/** Account confirmation / welcome email sent when a client account is created. */
export async function sendWelcomeEmail(to: string, name?: string | null) {
  const firstName = name?.split(" ")[0];
  return sendEmail({
    to,
    subject: "Welcome to ThinkBigJoe",
    html: layout(`
      <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;">Welcome${firstName ? `, ${firstName}` : ""} 👋</h1>
      <p style="margin:0;font-size:15px;line-height:1.6;color:#5b616e;">
        Your ThinkBigJoe account is all set. From your portal you'll be able to
        track your project's progress and manage billing in one place.
      </p>
      ${button(`${SITE_URL}/portal`, "Go to your portal")}
    `),
  });
}

/** Password-reset email with a one-time reset link (expires in 1 hour). */
export async function sendResetPasswordEmail(to: string, url: string, name?: string | null) {
  const firstName = name?.split(" ")[0];
  return sendEmail({
    to,
    subject: "Reset your ThinkBigJoe password",
    html: layout(`
      <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;">Reset your password</h1>
      <p style="margin:0;font-size:15px;line-height:1.6;color:#5b616e;">
        Hi${firstName ? ` ${firstName}` : ""}, we got a request to reset the password on your
        ThinkBigJoe account. Choose a new one with the button below — this link expires in 1 hour.
      </p>
      ${button(url, "Reset password")}
      <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#9aa0ad;">
        If you didn't request this, you can safely ignore this email — your password won't change.
      </p>
    `),
  });
}

/**
 * Generic notification email for product events (e.g. a new design or store
 * was created). Call this from those features as they're built.
 */
export async function sendNotificationEmail(args: {
  to: string;
  subject: string;
  heading: string;
  message: string;
  ctaUrl?: string;
  ctaLabel?: string;
}) {
  return sendEmail({
    to: args.to,
    subject: args.subject,
    html: layout(`
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:800;">${args.heading}</h1>
      <p style="margin:0;font-size:15px;line-height:1.6;color:#5b616e;">${args.message}</p>
      ${args.ctaUrl ? button(args.ctaUrl, args.ctaLabel ?? "View in portal") : ""}
    `),
  });
}
