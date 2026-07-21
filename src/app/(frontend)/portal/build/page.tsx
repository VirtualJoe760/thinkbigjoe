import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { CallIvy } from "@/components/portal/call-ivy";

export const metadata: Metadata = { title: "Get a site built" };

/**
 * "Build a new site" — a call to Ivy now, not a form. She takes the business details on the phone
 * and the forge builds from there. The website is a separate one-time purchase (voice-first model,
 * see docs/PORTAL_REDESIGN.md); Ivy handles the specifics on the call.
 */
export default async function BuildPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/portal/build");

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-12">
      <Link href="/portal" className="text-sm font-semibold text-brand hover:underline">
        ← Back to portal
      </Link>
      <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-brand">New site</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Get a website built</h1>
      <p className="mt-3 leading-relaxed text-ink-soft">
        Tell Ivy about your business and we&apos;ll build your site — it shows up in your portal
        shortly after.
      </p>

      <div className="mt-8">
        <CallIvy
          heading="Call Ivy about a website"
          blurb="She takes down what your business does and how you want it to look, and the site gets built from there. A website is a one-time build — she'll walk you through it."
          steps={[
            "Tell Ivy your business name and what you do.",
            "Say how you want it to feel — she takes it from there.",
            "Your new site lands in your portal to review.",
          ]}
        />
      </div>
    </main>
  );
}
