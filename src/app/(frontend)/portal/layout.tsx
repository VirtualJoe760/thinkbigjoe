import { PortalBottomNav } from "@/components/portal/portal-bottom-nav";

/** Wraps every /portal route. The header is rendered per-page (it needs the user's email/isAdmin);
 *  this adds the mobile PWA bottom bar site-wide. The bottom bar hides itself on full-screen tool
 *  routes and renders its own spacer, so pages don't need to know about it. */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <PortalBottomNav />
    </>
  );
}
