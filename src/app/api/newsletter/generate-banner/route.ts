import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";

import { auth } from "@/lib/auth";
import { db, forgeSites, newsletters } from "@/db";
import { generateImage, geminiConfigured } from "@/lib/gemini-image";
import { uploadImage, isBlobConfigured } from "@/lib/blob";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// The stored banner is always this fixed size (3:1) so every banner — uploaded or generated —
// renders consistently across the top of the email.
const BANNER_W = 1200;
const BANNER_H = 400;

/**
 * Generate a banner image with Gemini from the owner's prompt, crop it to banner dimensions, store
 * it on Vercel Blob, and set it as this newsletter's banner. Auth'd + site-scoped. The image model
 * renders text poorly, so we steer it toward a clean textless header (the business name already
 * renders below the banner in the email). See docs/NEWSLETTER.md.
 */
export async function POST(req: Request) {
  if (!geminiConfigured()) return NextResponse.json({ ok: false, message: "AI image generation isn't available right now." }, { status: 503 });
  if (!isBlobConfigured) return NextResponse.json({ ok: false, message: "Image storage isn't available right now." }, { status: 503 });

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ ok: false, message: "Please sign in." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const siteId = Number(body?.siteId);
  const newsletterId = Number(body?.newsletterId);
  const userPrompt = String(body?.prompt || "").trim().slice(0, 500);
  if (!Number.isFinite(siteId) || !Number.isFinite(newsletterId)) return NextResponse.json({ ok: false, message: "Missing newsletter." }, { status: 400 });
  if (!userPrompt) return NextResponse.json({ ok: false, message: "Describe the banner you want." }, { status: 400 });

  // Ownership + a little business context to keep the image on-brand.
  const [site] = await db
    .select({ claimedByUserId: forgeSites.claimedByUserId, businessName: forgeSites.businessName, niche: forgeSites.niche })
    .from(forgeSites)
    .where(eq(forgeSites.id, siteId))
    .limit(1);
  if (!site || site.claimedByUserId !== session.user.id) return NextResponse.json({ ok: false, message: "Not your site." }, { status: 403 });

  const niche = site.niche ? ` for a ${site.niche} business` : "";
  const prompt =
    `A wide horizontal email header banner image${niche}: ${userPrompt}. ` +
    `Clean, professional, well-composed, high quality. Fills the whole frame edge to edge. ` +
    `IMPORTANT: absolutely no text, no words, no letters, no numbers, and no logos anywhere in the image.`;

  try {
    // Gemini's widest supported ratio is 21:9; we crop to a true banner (3:1) below.
    const dataUrl = await generateImage(prompt, undefined, "21:9");
    if (!dataUrl) return NextResponse.json({ ok: false, message: "Couldn't generate an image — try a different description." }, { status: 502 });

    const m = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
    if (!m) return NextResponse.json({ ok: false, message: "Image generation failed — try again." }, { status: 502 });

    const webp = await sharp(Buffer.from(m[1], "base64"))
      .resize(BANNER_W, BANNER_H, { fit: "cover" })
      .webp({ quality: 82 })
      .toBuffer();

    const { url } = await uploadImage(webp, { pathPrefix: `newsletter/${siteId}`, ext: "webp", contentType: "image/webp" });

    await db.update(newsletters)
      .set({ bannerUrl: url, updatedAt: new Date().toISOString() })
      .where(and(eq(newsletters.id, newsletterId), eq(newsletters.siteId, siteId)));

    return NextResponse.json({ ok: true, url });
  } catch (err) {
    console.error("[newsletter/generate-banner] failed:", err);
    return NextResponse.json({ ok: false, message: "Couldn't generate that banner — try again." }, { status: 500 });
  }
}
