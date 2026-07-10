/** Wraps every /portal route. The header is rendered per-page (it needs the user's email/isAdmin),
 *  and it's the unified <AppHeader> — the same navbar the public site and command center use, so
 *  the portal needs nothing extra here. */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
