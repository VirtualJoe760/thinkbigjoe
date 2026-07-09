import type { Metadata } from "next";

import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { BUSINESS } from "@/lib/business";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `${BUSINESS.brand} Terms of Service, including SMS/messaging program terms.`,
};

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 text-xl font-bold tracking-tight text-ink">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 leading-relaxed text-ink-soft">{children}</p>;
}

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteNav />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-4xl font-extrabold tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-sm text-ink-soft">Effective {BUSINESS.effectiveDate}</p>
        <P>
          These Terms of Service (&ldquo;Terms&rdquo;) govern your use of {BUSINESS.brand} (&ldquo;{BUSINESS.brand},&rdquo;
          &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;), including our website at{" "}
          {BUSINESS.site}, our websites-and-AI services, and our messaging program. By using our services or opting into
          our messages, you agree to these Terms.
        </P>

        <H>1. Our services</H>
        <P>
          {BUSINESS.brand} builds and hosts websites, provides an AI phone receptionist and AI chat, and delivers related
          automation for local businesses. Some features rely on third-party providers (for example, Stripe for payments,
          Twilio for SMS and voice, and Google for calendar and email); your use of those features is also subject to those
          providers&apos; terms.
        </P>

        <H>2. Accounts</H>
        <P>
          You are responsible for the information you provide and for activity under your account. You agree to provide
          accurate information and to keep your login credentials secure. You must be at least 18 years old to use our
          services.
        </P>

        <H>3. Billing</H>
        <P>
          Paid plans include a one-time build fee plus a recurring monthly subscription, billed through Stripe. Subscriptions
          renew automatically until cancelled. You can manage or cancel your subscription from your portal. Third-party costs
          (such as domain registration) may apply and are disclosed at checkout.
        </P>

        <H>4. Messaging program terms (SMS)</H>
        <P>
          By providing your mobile number and opting in, you consent to receive text messages from {BUSINESS.brand} at the
          number you provide. Our messaging program includes:
        </P>
        <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed text-ink-soft">
          <li>
            <span className="font-semibold text-ink">What we send:</span> appointment and booking confirmations and
            reminders, website preview and claim links, account and service updates, replies to your inquiries, and — only if
            you separately opt in — occasional promotional offers.
          </li>
          <li>
            <span className="font-semibold text-ink">Message frequency:</span> message frequency varies based on your
            activity and the messages you&apos;ve opted into.
          </li>
          <li>
            <span className="font-semibold text-ink">Cost:</span> <span className="font-semibold text-ink">Message and
            data rates may apply.</span> {BUSINESS.brand} does not charge for the messages themselves; your mobile carrier&apos;s
            standard rates apply.
          </li>
          <li>
            <span className="font-semibold text-ink">Opt out:</span> reply <span className="font-mono font-semibold text-ink">STOP</span>{" "}
            at any time to cancel. After you send STOP, we will send one confirmation message and then stop sending texts to
            that number. To resume, reply <span className="font-mono font-semibold text-ink">START</span>.
          </li>
          <li>
            <span className="font-semibold text-ink">Help:</span> reply <span className="font-mono font-semibold text-ink">HELP</span>{" "}
            for help, or contact us at {BUSINESS.email} or {BUSINESS.phone}.
          </li>
          <li>
            <span className="font-semibold text-ink">Carriers:</span> carriers are not liable for delayed or undelivered
            messages. Supported carriers may change without notice.
          </li>
        </ul>
        <P>
          Your consent to receive text messages is not a condition of purchasing any goods or services. Mobile opt-in and
          your consent to receive text messages are never shared with or sold to any third parties or affiliates for their
          own marketing purposes. See our{" "}
          <a href="/privacy-policy" className="font-semibold text-brand hover:underline">Privacy Policy</a> for how we handle
          your information.
        </P>

        <H>5. Acceptable use</H>
        <P>
          You agree not to misuse our services — no unlawful, infringing, or abusive activity; no attempts to disrupt or
          reverse-engineer the platform; and no use of our messaging or AI features to send spam or unlawful content.
        </P>

        <H>6. Disclaimers &amp; limitation of liability</H>
        <P>
          Our services are provided &ldquo;as is&rdquo; without warranties of any kind. To the fullest extent permitted by
          law, {BUSINESS.dba} is not liable for indirect, incidental, or consequential damages arising from your use of the
          services.
        </P>

        <H>7. Changes</H>
        <P>
          We may update these Terms from time to time. Material changes will be posted here with a new effective date.
          Continued use after changes take effect constitutes acceptance.
        </P>

        <H>8. Contact us</H>
        <P>
          {BUSINESS.dba}
          <br />
          Email: <a href={`mailto:${BUSINESS.email}`} className="text-brand hover:underline">{BUSINESS.email}</a>
          <br />
          Phone: <a href={`tel:${BUSINESS.phoneHref}`} className="text-brand hover:underline">{BUSINESS.phone}</a>
          <br />
          {BUSINESS.address}
        </P>
      </main>
      <SiteFooter />
    </div>
  );
}
