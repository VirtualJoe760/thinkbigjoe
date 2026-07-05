import { headers } from "next/headers";
import { eq } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * Serves a client's live site FROM OUR ORIGIN with the editor injected, so the
 * portal can iframe it same-origin and the editor can read/click real elements.
 * We inject <base> (so the site's relative/_next assets still resolve against
 * its real host) + editor.js. Only the site's owner (or an admin) can open it.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const siteId = Number(id);
  if (!Number.isFinite(siteId)) return new Response("Bad id", { status: 400 });

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const [site] = await db.select().from(forgeSites).where(eq(forgeSites.id, siteId)).limit(1);
  if (!site) return new Response("Not found", { status: 404 });

  const owns = site.claimedByUserId === session.user.id || isAdminEmail(session.user.email);
  if (!owns) return new Response("Forbidden", { status: 403 });
  if (!site.liveUrl) return new Response("This site has no live URL yet.", { status: 409 });

  let html: string;
  try {
    const res = await fetch(site.liveUrl, { headers: { "user-agent": "TBJ-Editor" } });
    html = await res.text();
  } catch {
    return new Response("Couldn't load the site.", { status: 502 });
  }

  const base = site.liveUrl.replace(/\/$/, "") + "/";
  const inject =
    `<base href="${base}">` +
    // Neutralize any inline CSP that would block our editor script.
    "";
  html = html
    // Drop CSP meta tags that could block the injected script.
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "");

  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>${inject}`);
  } else {
    html = inject + html;
  }

  const editorTag =
    `<script>window.__TBJ_EDIT=${JSON.stringify({ siteId, saveUrl: "/api/edit-requests" })};</script>` +
    `<script src="/editor.js"></script>`;
  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, `${editorTag}</body>`);
  } else {
    html += editorTag;
  }

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Allow our own portal to frame it; block everyone else.
      "content-security-policy": "frame-ancestors 'self'",
      "cache-control": "no-store",
    },
  });
}
