import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * Returns the client site's existing image assets (logo, hero, photos) as
 * absolute URLs, so the Image Studio can load them for editing. Owner/admin only.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const siteId = Number(id);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [site] = await db.select().from(forgeSites).where(eq(forgeSites.id, siteId)).limit(1);
  if (!site) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owns = site.claimedByUserId === session.user.id || isAdminEmail(session.user.email);
  if (!owns) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!site.liveUrl) return NextResponse.json({ assets: [] });

  const origin = site.liveUrl.replace(/\/$/, "");
  let html = "";
  try {
    html = await (await fetch(site.liveUrl)).text();
  } catch {
    return NextResponse.json({ assets: [] });
  }

  // Collect candidate image paths from <img src>, srcset, and og:image.
  const paths = new Set<string>();
  const push = (raw?: string) => {
    if (!raw) return;
    let p = raw.trim();
    // Unwrap Next.js optimizer: /_next/image?url=%2Flogo%2Flogo.png&w=...
    const m = p.match(/\/_next\/image\?url=([^&"']+)/);
    if (m) p = decodeURIComponent(m[1]);
    if (/\.(png|jpe?g|webp|svg|gif)(\?|$)/i.test(p) && !/favicon/i.test(p)) paths.add(p.replace(/&amp;.*$/, ""));
  };
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) push(m[1]);
  for (const m of html.matchAll(/property=["']og:image["'][^>]*content=["']([^"']+)["']/gi)) push(m[1]);

  const abs = (p: string) => (/^https?:\/\//.test(p) ? p : origin + (p.startsWith("/") ? "" : "/") + p);
  const label = (p: string) =>
    /logo/i.test(p) ? "Logo" : /hero/i.test(p) ? "Hero" : /about|team/i.test(p) ? "About" : "Photo";

  const assets = Array.from(paths).slice(0, 24).map((p) => ({ label: label(p), url: abs(p) }));
  // Logo + Hero first.
  assets.sort((a, b) => (a.label === "Logo" ? -1 : b.label === "Logo" ? 1 : a.label === "Hero" ? -1 : b.label === "Hero" ? 1 : 0));

  return NextResponse.json({ assets });
}
