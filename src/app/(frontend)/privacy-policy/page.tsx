import type { Metadata } from "next";

import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { BUSINESS } from "@/lib/business";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `${BUSINESS.brand} Privacy Policy, including how we handle SMS/mobile opt-in data.`,
};

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 text-xl font-bold tracking-tight text-ink">{children}</h2>;
}
function P({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`mt-3 leading-relaxed text-ink-soft ${className}`}>{children}</p>;
}

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteNav />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-4xl font-extrabold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-ink-soft">Effective {BUSINESS.effectiveDate}</p>
        <P>
          This Privacy Policy explains how {BUSINESS.brand} (&ldquo;{BUSINESS.brand},&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;)
          collects, uses, and protects your information when you use our website at {BUSINESS.site},
          our services, and our messaging program.
        </P>

        <H>1. Information we collect</H>
        <P>
          We collect information you provide directly — such as your name, email address, phone number, business details, and
          any message you send us — as well as information collected automatically when you use our site (such as device and
          usage data via privacy-friendly analytics). If you claim or purchase a site, we also process account and billing
          information through our payment processor.
        </P>

        <H>2. How we use your information</H>
        <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed text-ink-soft">
          <li>To provide, build, host, and support your website and related services.</li>
          <li>To respond to your inquiries and provide customer care.</li>
          <li>To send transactional messages (e.g., appointment confirmations, reminders, preview/claim links, service updates).</li>
          <li>With your separate opt-in, to send promotional messages about our services.</li>
          <li>To operate our AI receptionist and chat features on your behalf.</li>
          <li>To process payments, prevent fraud, and comply with legal obligations.</li>
        </ul>

        <H>3. SMS / text messaging &amp; mobile opt-in</H>
        <P>
          If you provide your mobile number and opt in, you may receive text messages from {BUSINESS.brand}.
          <span className="font-semibold text-ink"> Message and data rates may apply</span>, and message frequency varies. You
          can reply <span className="font-mono font-semibold text-ink">STOP</span> at any time to opt out, or{" "}
          <span className="font-mono font-semibold text-ink">HELP</span> for help. Full details are in our{" "}
          <a href="/terms-of-service" className="font-semibold text-brand hover:underline">Terms of Service</a>.
        </P>
        <P>
          <span className="font-semibold text-ink">
            We do not share or sell your mobile opt-in information, phone number, or SMS consent to any third parties or
            affiliates for their own marketing purposes.
          </span>{" "}
          Text-messaging originator opt-in data and consent are not shared with any third party except subprocessors that
          help us deliver the messaging service (for example, our SMS provider, Twilio), and only for that purpose.
        </P>

        <H>4. How we share information</H>
        <P>
          We share information only with service providers that help us operate (such as Stripe for payments, Twilio for SMS
          and voice, and Google for calendar and email), when required by law, or in connection with a business transfer. As
          stated above, we never sell your personal information or share your SMS opt-in data for third-party marketing.
        </P>

        {/*
          Required for Google OAuth verification. We request two SENSITIVE scopes
          (calendar.events, contacts), and Google's #1 rejection reason is a privacy policy that
          doesn't name the scopes, say what each is used for, and carry the Limited Use affirmation
          VERBATIM. Keep this section in sync with GOOGLE_SCOPES in src/lib/google-oauth.ts — if a
          scope is added there and not disclosed here, verification is revoked.
        */}
        <H>5. Google user data</H>
        <P>
          If you choose to connect your Google account, {BUSINESS.brand} requests only the access needed to run the
          features you asked for. We request:
        </P>
        <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed text-ink-soft">
          <li>
            <span className="font-mono text-sm font-semibold text-ink">userinfo.email</span> — to identify which Google
            account you connected and link it to your {BUSINESS.brand} account.
          </li>
          <li>
            <span className="font-mono text-sm font-semibold text-ink">calendar.events</span> — to read your availability
            and create appointments on your calendar when a customer books through your website or our AI receptionist,
            and to show those appointments in your portal calendar. We do not read or store the contents of unrelated
            personal events.
          </li>
          <li>
            <span className="font-mono text-sm font-semibold text-ink">contacts</span> — to import the contacts you choose
            into your newsletter list, and to save new leads from your website back into your Google Contacts so your
            customer list stays in one place.
          </li>
        </ul>
        <P>
          You can disconnect your Google account at any time — the <span className="font-semibold text-ink">Disconnect</span>{" "}
          button on your portal Calendar page — or revoke our access directly at{" "}
          <a href="https://myaccount.google.com/permissions" className="font-semibold text-brand hover:underline" target="_blank" rel="noreferrer">
            myaccount.google.com/permissions
          </a>
          . When you disconnect, we delete the stored access and refresh tokens for that account.
        </P>
        <P className="font-semibold text-ink">
          {BUSINESS.brand}&apos;s use and transfer of information received from Google APIs to any other app will adhere to
          the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="font-semibold text-brand hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </P>
        <P>
          Specifically: we do not use Google user data to serve advertising, we do not sell it, we do not transfer it to
          others except as necessary to provide or improve the features you requested, to comply with applicable law, or as
          part of a merger or acquisition, and we do not allow humans to read it unless we have your explicit consent, it is
          necessary for security or to comply with applicable law, or the data is aggregated and anonymized.
        </P>

        <H>6. Data retention &amp; security</H>
        <P>
          We keep information for as long as needed to provide our services and meet legal requirements, and we use reasonable
          administrative and technical safeguards to protect it. No method of transmission is 100% secure.
        </P>

        <H>7. Your choices &amp; rights</H>
        <P>
          You may opt out of marketing messages at any time (reply STOP to texts, or unsubscribe from emails). You may request
          access to, correction of, or deletion of your personal information by contacting us at {BUSINESS.email}. Depending on
          your location, you may have additional rights under applicable privacy laws.
        </P>

        <H>8. Children&apos;s privacy</H>
        <P>Our services are not directed to children under 13, and we do not knowingly collect their information.</P>

        <H>9. Changes to this policy</H>
        <P>We may update this policy; material changes will be posted here with a new effective date.</P>

        <H>10. Contact us</H>
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
