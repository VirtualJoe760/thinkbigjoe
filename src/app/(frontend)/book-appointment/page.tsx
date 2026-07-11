import type { Metadata } from "next";

import { BookingWizard } from "@/components/booking/booking-wizard";
import { Logo } from "@/components/logo";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Book a Strategy Call",
  description:
    "Tell us about your business, then pick a time — a free 30-minute strategy call mapping where custom AI can actually move your business.",
};

export default async function BookAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-6xl px-6 py-6">
        <Logo />
      </div>
      <main className="flex-1 px-6 pb-24 pt-6">
        <div className="mx-auto w-full max-w-2xl">
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">
            Book a strategy call
          </h1>
          <p className="mt-2 text-ink-soft">
            Free 30 minutes with Joe. Tell us a little about your business
            first — call slots are reserved for completed intakes.
          </p>
          <div className="mt-6">
            <BookingWizard initialToken={t} />
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
