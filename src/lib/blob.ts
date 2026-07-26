/**
 * Object storage for user-uploaded media (currently: newsletter banners + inline images).
 *
 * Backed by Vercel Blob — public CDN URLs, served off the edge, never through Neon (so email opens
 * that load an image don't hit our egress-constrained Postgres). Everything storage-specific lives
 * HERE behind `uploadImage`, so moving to Cloudflare R2 / S3 later (for zero-egress at scale) is a
 * one-file change, not a hunt through routes. See docs/EMAIL_SCALE.md.
 */
import { put } from "@vercel/blob";

export const isBlobConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

/** Allowed image types for uploads (what renders reliably across email clients). */
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

/**
 * Store an image and return its permanent public URL. `pathPrefix` namespaces the object (e.g.
 * `newsletter/<siteId>`), `ext` is the file extension (no dot). A random suffix keeps uploads from
 * colliding and makes URLs unguessable. Throws if Blob isn't configured — callers guard on that.
 */
export async function uploadImage(
  bytes: Buffer,
  opts: { pathPrefix: string; ext: string; contentType: string },
): Promise<{ url: string }> {
  if (!isBlobConfigured) throw new Error("Blob storage is not configured (BLOB_READ_WRITE_TOKEN).");
  const rand = crypto.randomUUID().slice(0, 12);
  const key = `${opts.pathPrefix.replace(/^\/+|\/+$/g, "")}/${rand}.${opts.ext}`;
  const { url } = await put(key, bytes, {
    access: "public",
    contentType: opts.contentType,
    // Content is already uniquified by the random key; don't let Blob append its own suffix.
    addRandomSuffix: false,
  });
  return { url };
}

/**
 * Re-host a call recording so it outlives Retell's ~10-minute link expiry. Fetches the (still-live)
 * recording URL and stores the audio permanently; returns the public URL, or null on any failure —
 * callers keep the expiring URL as a best-effort fallback rather than losing the row.
 */
export async function saveRecording(
  sourceUrl: string,
  opts: { pathPrefix: string },
): Promise<string | null> {
  if (!isBlobConfigured || !sourceUrl) return null;
  try {
    const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "audio/wav";
    const ext = contentType.includes("mp3") || contentType.includes("mpeg") ? "mp3" : "wav";
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 1000 || bytes.length > 100_000_000) return null; // empty or absurd
    const key = `${opts.pathPrefix.replace(/^\/+|\/+$/g, "")}/${crypto.randomUUID().slice(0, 12)}.${ext}`;
    const { url } = await put(key, bytes, { access: "public", contentType, addRandomSuffix: false });
    return url;
  } catch (err) {
    console.error("[blob] saveRecording failed:", err);
    return null;
  }
}
