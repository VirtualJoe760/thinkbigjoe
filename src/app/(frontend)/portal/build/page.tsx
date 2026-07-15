import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { BuildForm } from "./build-form";

export const metadata: Metadata = { title: "Get a site built" };

export default async function BuildPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/portal/build");

  return (
    <div className="flex flex-1 flex-col">

      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-12">
        <Link href="/portal" className="text-sm font-semibold text-brand hover:underline">← Back to portal</Link>
        <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-brand">New site</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Get your site built</h1>
        <p className="mt-3 leading-relaxed text-ink-soft">
          Tell us about your business and we&apos;ll build your website — it&apos;ll appear in your portal shortly.
          You get <span className="font-semibold text-ink">7 days free</span> to play with it before you decide.
        </p>

        <div className="mt-8">
          <BuildForm defaultEmail={session.user.email} />
        </div>
      </main>
    </div>
  );
}
