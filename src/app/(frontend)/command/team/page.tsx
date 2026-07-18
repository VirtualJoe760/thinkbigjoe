import type { Metadata } from "next";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { Card, cardClass } from "@/components/ui";
import { SubNav, VENUS_TABS } from "../sub-nav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Team",
  robots: { index: false, follow: false },
};

type PortalUser = { name?: string | null; email?: string | null; createdAt?: string | null };

export default async function TeamPage() {
  const { email } = await requireAdmin();

  let portal: PortalUser[] = [];
  let portalError = false;
  try {
    const result = (await db.execute(
      sql`select name, email, "createdAt" from better_auth."user" order by "createdAt" desc limit 200`,
    )) as unknown as { rows?: PortalUser[] } | PortalUser[];
    portal = Array.isArray(result) ? result : (result.rows ?? []);
  } catch {
    portalError = true;
  }

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-4xl">
        <SubNav items={VENUS_TABS} />
        <h1 className="text-2xl font-extrabold tracking-tight">Team &amp; users</h1>

        <h2 className="mt-6 mb-2 text-sm font-bold tracking-wide text-ink-soft uppercase">
          Admin
        </h2>
        <Card>
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-tint text-sm font-semibold text-brand">
              {(email[0] || "?").toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold">{email}</p>
              <p className="text-xs text-ink-soft">Command Center admin (allowlisted)</p>
            </div>
          </div>
        </Card>

        <h2 className="mt-8 mb-2 text-sm font-bold tracking-wide text-ink-soft uppercase">
          Portal accounts ({portal.length})
        </h2>
        {portalError ? (
          <div className={cardClass({ padding: "lg", className: "text-sm text-ink-soft" })}>
            Couldn&apos;t load portal accounts right now.
          </div>
        ) : portal.length === 0 ? (
          <div className={cardClass({ padding: "lg", className: "text-sm text-ink-soft" })}>
            No client/portal accounts yet. These are people who sign up at the client login.
          </div>
        ) : (
          <div className="space-y-2">
            {portal.map((u, i) => (
              <div key={i} className={cardClass({ radius: "xl", padding: "none", className: "flex items-center justify-between px-4 py-3" })}>
                <div>
                  <p className="text-sm font-medium">{u.name || u.email}</p>
                  {u.name && <p className="text-xs text-ink-soft">{u.email}</p>}
                </div>
                {u.createdAt && (
                  <span className="text-xs text-ink-soft">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
