import { redirect } from "next/navigation";

/**
 * Old per-site receptionist setup form. Setup is a call to Ivy now — redirect to the receptionist
 * dashboard for that site. See docs/PORTAL_REDESIGN.md.
 */
export default async function ReceptionistSetupRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/portal/dashboard?site=${id}`);
}
