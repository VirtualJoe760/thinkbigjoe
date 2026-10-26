import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { BuildForm } from "./build-form";

export const metadata: Metadata = { title: "Tell us about your business" };

/**
 * Business intake — the front door for anyone who signs up WITHOUT a claim code (2026-10-26).
 * New accounts with no site are sent here from /portal. The form goes to Joe (email + Telegram),
 * into the CRM, and onto the forge queue. People who'd rather talk can call Maddie.
 */
export default async function BuildPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/portal/build");
  const { welcome } = await searchParams;
  const firstName = session.user.name?.split(" ")[0];

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <Link href="/portal" className="text-sm font-semibold text-brand hover:underline">
        ← Back to portal
      </Link>
      <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-brand">
        {welcome ? `Welcome${firstName ? `, ${firstName}` : ""}!` : "Get started"}
      </p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Tell us about your business</h1>
      <p className="mt-3 leading-relaxed text-ink-soft">
        A few quick questions so we know what you need — a website, AI that answers your calls,
        or a full custom system. Joe looks over every one personally.
      </p>

      <div className="mt-8">
        <BuildForm defaultEmail={session.user.email} defaultName={session.user.name ?? ""} />
      </div>

      <div className="mt-10 grid gap-4 border-t border-line pt-8 text-sm text-ink-soft sm:grid-cols-2">
        <p>
          <span className="font-semibold text-ink">Got a code from us?</span>{" "}
          <Link href="/portal/claim" className="font-semibold text-brand hover:underline">
            Claim your site instead →
          </Link>
        </p>
        <p>
          <span className="font-semibold text-ink">Rather talk?</span> Call Maddie, our assistant, at{" "}
          <a href="tel:+14807642121" className="font-semibold text-brand hover:underline">
            (480) 764-2121
          </a>
          .
        </p>
      </div>
    </main>
  );
}
