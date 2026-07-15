import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db, forgeSites } from "@/db";
import { uploadImage, isBlobConfigured, ALLOWED_IMAGE_TYPES } from "@/lib/blob";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

// Uploads are downscaled server-side so a client can't blow up the email (or our storage) with a
// 12 MP phone photo. Banner = full-width hero; inline = drops into the body.
const MAX_WIDTH = { banner: 1200, inline: 800 } as const;
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB in; we re-encode smaller

/**
 * Upload a newsletter image (banner or inline) → Vercel Blob → returns its public CDN URL. Auth'd
 * and scoped to a site the caller owns. Re-encodes to a web-friendly size/format so emailed images
 * stay small and render everywhere. See src/lib/blob.ts + docs/EMAIL_SCALE.md.
 */
export async function POST(req: Request) {
  if (!isBlobConfigured) {
    return NextResponse.json({ ok: false, message: "Image uploads aren't available right now." }, { status: 503 });
  }
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ ok: false, message: "Please sign in." }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const siteId = Number(form.get("siteId"));
  const kind = form.get("kind") === "banner" ? "banner" : "inline";
  if (!(file instanceof File)) return NextResponse.json({ ok: false, message: "No file provided." }, { status: 400 });
  if (!Number.isFinite(siteId)) return NextResponse.json({ ok: false, message: "Missing site." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, message: "That image is too large (max 8 MB)." }, { status: 400 });
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return NextResponse.json({ ok: false, message: "Use a JPG, PNG, GIF, or WebP image." }, { status: 400 });
  }

  // Ownership: the caller must own this site.
  const [site] = await db
    .select({ claimedByUserId: forgeSites.claimedByUserId })
    .from(forgeSites)
    .where(and(eq(forgeSites.id, siteId)))
    .limit(1);
  if (!site || site.claimedByUserId !== session.user.id) {
    return NextResponse.json({ ok: false, message: "Not your site." }, { status: 403 });
  }

  try {
    // Dynamic import: sharp's native binary crashes the route module at load on Vercel if imported
    // at the top level. Loading it here keeps it off the module-load path.
    const sharp = (await import("sharp")).default;
    const input = Buffer.from(await file.arrayBuffer());
    let out: Buffer;
    let ext: string;
    let contentType: string;

    if (file.type === "image/gif") {
      // Preserve animation — don't re-encode GIFs (sharp would flatten or bloat them).
      out = input;
      ext = "gif";
      contentType = "image/gif";
    } else {
      // Auto-orient (honor EXIF), cap width, strip metadata, re-encode to compact WebP.
      out = await sharp(input)
        .rotate()
        .resize({ width: MAX_WIDTH[kind], withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      ext = "webp";
      contentType = "image/webp";
    }

    const { url } = await uploadImage(out, { pathPrefix: `newsletter/${siteId}`, ext, contentType });
    return NextResponse.json({ ok: true, url });
  } catch (err) {
    console.error("[newsletter/upload] failed:", err);
    return NextResponse.json({ ok: false, message: "Couldn't process that image — try another." }, { status: 500 });
  }
}
