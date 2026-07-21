import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { CallIvy } from "@/components/portal/call-ivy";

export const metadata: Metadata = { title: "Build custom agents" };

/**
 * "Build your agents" — a call to Ivy now, not a form or a marketing page. Custom agents are scoped
 * on the call, then Joe builds them. The /solutions page still exists as the deeper explainer; this
 * is the action. See docs/PORTAL_REDESIGN.md.
 */
export default async function AgentsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/portal/agents");

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-12">
      <Link href="/portal" className="text-sm font-semibold text-brand hover:underline">
        ← Back to portal
      </Link>
      <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-brand">Custom agents</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Build agents around your business</h1>
      <p className="mt-3 leading-relaxed text-ink-soft">
        Follow-up, reactivation, review requests, recruiting — custom AI agents wired into how you
        actually work. Tell Ivy what you&apos;re trying to fix and we&apos;ll scope it.
      </p>

      <div className="mt-8">
        <CallIvy
          heading="Call Ivy about custom agents"
          blurb="Tell her the busywork or the leaks you want handled — chasing unsold quotes, reactivating old customers, staffing. She scopes it and Joe builds it."
          steps={[
            "Tell Ivy what work you want off your plate.",
            "She captures the specifics and passes it to Joe.",
            "Joe scopes a plan and follows up to build it.",
          ]}
        />
      </div>

      <p className="mt-6 text-sm text-ink-soft">
        Want to see what&apos;s possible first?{" "}
        <Link href="/solutions" className="font-semibold text-brand hover:underline">
          Explore agentic solutions
        </Link>
        .
      </p>
    </main>
  );
}
