import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { isCalendarConfigured } from "@/lib/gcal";
import { PortalHeader } from "@/components/portal/portal-header";
import { BookForm } from "./book-form";

export const metadata: Metadata = { title: "Book a call with Joe" };

export default async function BookPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/portal/book");

  const configured = isCalendarConfigured();

  return (
    <div className="flex flex-1 flex-col">
      <PortalHeader email={session.user.email} isAdmin={isAdminEmail(session.user.email)} />

      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-12">
        <Link href="/portal" className="text-sm font-semibold text-brand hover:underline">← Back to portal</Link>
        <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-brand">Talk to Joe</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Book a call</h1>
        <p className="mt-3 leading-relaxed text-ink-soft">
          Grab a 30-minute strategy call with Joe over Google Meet — pick a day and time that works.
          You&apos;ll get a calendar invite with the video link right away.
        </p>

        <div className="mt-8">
          {configured ? (
            <BookForm defaultName={session.user.name} email={session.user.email} />
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Booking is temporarily unavailable. Please email{" "}
              <a href="mailto:joe@thinkbigjoe.com" className="font-semibold underline">joe@thinkbigjoe.com</a> and
              we&apos;ll find a time.
            </div>
          )}
        </div>

        <p className="mt-8 rounded-xl border border-line bg-surface p-4 text-xs leading-relaxed text-ink-soft">
          Calls run Monday–Friday, 10 AM–5 PM Pacific (lunch break at noon), in 30-minute slots. Need a different time?
          Email <span className="font-semibold text-ink">joe@thinkbigjoe.com</span>.
        </p>
      </main>
    </div>
  );
}
