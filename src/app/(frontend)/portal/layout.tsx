import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { PortalHeader } from "@/components/portal/portal-header";

/**
 * Wraps every /portal route with the shared navbar. The header lives HERE, not per-page, so a new
 * portal page can't forget it (which is exactly how /portal/newsletter shipped without one). Pages
 * render only their own content. Auth stays each page's responsibility (they redirect to /login);
 * the header simply renders whenever there's a session.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  const user = session?.user;

  return (
    <div className="flex min-h-full flex-col">
      {user && <PortalHeader email={user.email} isAdmin={isAdminEmail(user.email)} />}
      {children}
    </div>
  );
}
