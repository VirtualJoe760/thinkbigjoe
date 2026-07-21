import { redirect } from "next/navigation";

/**
 * The receptionist SETUP FORM lived here. It's gone — setup is a phone call to Ivy now (voice-first
 * model, see docs/PORTAL_REDESIGN.md). This route stays only to redirect old links/bookmarks to the
 * receptionist dashboard, which now carries both the "call Ivy to set up / change" panel and the
 * call history.
 */
export default async function ReceptionistRedirect({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const { site } = await searchParams;
  redirect(site ? `/portal/dashboard?site=${site}` : "/portal/dashboard");
}
