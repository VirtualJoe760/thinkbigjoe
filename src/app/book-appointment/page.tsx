import type { Metadata } from "next";

import { BookingWizard } from "@/components/booking/booking-wizard";
import { Logo } from "@/components/logo";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Book a Strategy Call",
  description:
    "Book a free 30-minute strategy call with Joe — map where agentic AI and MCP can actually move your business.",
};

export default function BookAppointmentPage() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-6xl px-6 py-6">
        <Logo />
      </div>
      <main className="flex-1 px-6 pb-24 pt-6">
        <BookingWizard />
      </main>
      <SiteFooter />
    </div>
  );
}
