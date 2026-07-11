import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Book a Strategy Call",
  robots: { index: false, follow: false },
};

/**
 * Strategy calls are reserved for members. Anyone hitting /book-appointment is
 * routed to their portal booking if signed in, or to create an account / log in
 * first. The public site encourages calling the hotline or creating an account
 * instead of booking directly.
 */
export default async function BookAppointmentPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  redirect(session ? "/portal/book" : "/login?redirect=/portal/book");
}
