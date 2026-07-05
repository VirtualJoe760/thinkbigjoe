import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PortalHeader } from "@/components/portal/portal-header";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";

export const metadata: Metadata = {
  title: "Connect your domain",
};

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
        {n}
      </div>
      <div className="pb-2">
        <h3 className="font-semibold tracking-tight">{title}</h3>
        <div className="mt-1 text-sm leading-relaxed text-ink-soft">{children}</div>
      </div>
    </div>
  );
}

function Record({ type, name, value }: { type: string; name: string; value: string }) {
  return (
    <div className="grid grid-cols-3 gap-2 border-t border-line py-2 font-mono text-xs">
      <span><span className="text-ink-soft">Type </span>{type}</span>
      <span><span className="text-ink-soft">Name </span>{name}</span>
      <span className="truncate"><span className="text-ink-soft">Value </span>{value}</span>
    </div>
  );
}

export default async function TransferPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/portal/transfer");

  return (
    <div className="flex flex-1 flex-col">
      <PortalHeader email={session.user.email} isAdmin={isAdminEmail(session.user.email)} />

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">Existing domain</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
          Connect a domain you already own
        </h1>
        <p className="mt-3 text-ink-soft">
          Keep your domain where it is and just point it at your new site — the
          fastest option — or transfer it to us so we manage everything. You keep
          ownership either way, and nothing changes until you make it.
        </p>

        {/* Option A: point DNS */}
        <section className="mt-10 rounded-2xl border border-line bg-surface p-8">
          <h2 className="text-lg font-bold tracking-tight">Option A — Point it at us (recommended)</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Stay with your current registrar (GoDaddy, Namecheap, etc.) and just
            update two DNS records. Live in minutes to a few hours.
          </p>
          <div className="mt-6 space-y-6">
            <Step n={1} title="Sign in to your domain registrar">
              Go to wherever you bought the domain and open its DNS settings.
            </Step>
            <Step n={2} title="Add these two records">
              <div className="mt-2 rounded-xl border border-line bg-background p-4">
                <Record type="A" name="@" value="76.76.21.21" />
                <Record type="CNAME" name="www" value="cname.vercel-dns.com" />
              </div>
              <p className="mt-2">Remove any old A/CNAME records that point elsewhere.</p>
            </Step>
            <Step n={3} title="Tell us the domain">
              Send it to us and we'll add it to your site and issue the SSL
              certificate automatically once DNS propagates.
            </Step>
          </div>
        </section>

        {/* Option B: transfer */}
        <section className="mt-6 rounded-2xl border border-line bg-surface p-8">
          <h2 className="text-lg font-bold tracking-tight">Option B — Transfer it to us</h2>
          <p className="mt-1 text-sm text-ink-soft">
            We become your registrar and manage renewals. Takes 5–7 days (a
            registrar rule, not us).
          </p>
          <div className="mt-6 space-y-6">
            <Step n={1} title="Unlock the domain">
              At your current registrar, turn off the &ldquo;domain lock&rdquo; /
              &ldquo;transfer lock.&rdquo;
            </Step>
            <Step n={2} title="Get your auth code">
              Request the &ldquo;EPP&rdquo; or &ldquo;authorization&rdquo; code — a
              short password your registrar gives you.
            </Step>
            <Step n={3} title="Send it to us">
              Share the domain + auth code and we'll start the transfer and keep
              you posted until it completes.
            </Step>
          </div>
        </section>

        <div className="mt-8 rounded-2xl border border-brand/40 bg-brand-tint p-6">
          <p className="text-sm font-semibold text-brand">Want us to handle it?</p>
          <p className="mt-1 text-sm text-ink-soft">
            Email <a href="mailto:josephsardella@gmail.com" className="font-medium text-brand hover:underline">josephsardella@gmail.com</a> or
            call <a href="tel:+14807642121" className="font-medium text-brand hover:underline">(480) 764-2121</a> with your
            domain and we'll walk you through it.
          </p>
        </div>
      </main>
    </div>
  );
}
