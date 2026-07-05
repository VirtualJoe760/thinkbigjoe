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

  const origin = new URL(req.url).origin; // our domain — editor + save must be absolute to it
  const base = site.liveUrl.replace(/\/$/, "") + "/";

  html = html
    // Drop CSP meta tags that could block the injected script.
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "")
    // Strip the site's own scripts so its Next.js runtime can't hydrate,
    // frame-bust, or navigate — we only want a static, styled, clickable page.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "")
    // Without the site's JS, lazy images never load — make them eager.
    .replace(/loading=(["'])lazy\1/gi, 'loading="eager"');

  // Since we stripped JS, scroll-reveal animations (which start at opacity:0 and
  // reveal via IntersectionObserver) would stay invisible. Force them visible.
  const fixCss =
    "<style id=\"__tbj-fix\">" +
    // Let CSS keyframe animations run (many templates fade content in on load —
    // freezing them left sections invisible). Force their end state visible too.
    "*{animation-play-state:running!important;animation-fill-mode:forwards!important;transition:none!important}" +
    // Force-reveal anything hidden by scroll animations (opacity / translate /
    // visibility), across inline styles, Tailwind utilities, AOS and framer-motion.
    "[class*=opacity-0],[style*='opacity:0'],[style*='opacity: 0'],[style*='visibility:hidden'],[style*='visibility: hidden'],[data-aos],[data-animate],[data-framer-appear-id],[class*='animate-']{opacity:1!important;visibility:visible!important}" +
    "[style*='opacity:0'],[style*='opacity: 0'],[style*='translate'],[class*='translate-y-'],[class*='translate-x-'],[data-aos],[data-framer-appear-id]{transform:none!important}" +
    "img{opacity:1!important;visibility:visible!important}" +
    "</style>";

  // <base> so the site's relative CSS/images still resolve against its real host.
  const baseTag = `<base href="${base}">` + fixCss;
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  } else {
    html = baseTag + html;
  }

  // Our editor — absolute URLs to OUR origin (base href would otherwise send
  // these to the client's domain).
  const editorTag =
    `<script>window.__TBJ_EDIT=${JSON.stringify({
      siteId,
      saveUrl: `${origin}/api/edit-requests`,
      genUrl: `${origin}/api/generate-image`,
    })};</script>` + `<script src="${origin}/editor.js"></script>`;
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
