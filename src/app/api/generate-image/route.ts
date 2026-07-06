import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { generateImage, geminiConfigured } from "@/lib/gemini-image";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // image generation can take a while

/** Editor "generate a logo/image with AI" → Gemini. Signed-in users only. */
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!geminiConfigured()) {
    return NextResponse.json({ ok: false, error: "Image generation isn't set up." }, { status: 503 });
  }

  let body: { prompt?: string; refUrl?: string; refDataUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  const prompt = (body.prompt || "").trim();
  if (prompt.length < 3) {
    return NextResponse.json({ ok: false, error: "Describe what you want first." }, { status: 400 });
  }
  // Editing (studio canvas) sends a data: URL; element-refine sends an https URL.
  const ref =
    typeof body.refDataUrl === "string" && body.refDataUrl.startsWith("data:")
      ? body.refDataUrl
      : typeof body.refUrl === "string" && /^https?:\/\//.test(body.refUrl)
        ? body.refUrl
        : undefined;

  try {
    const dataUrl = await generateImage(prompt, ref);
    if (!dataUrl) return NextResponse.json({ ok: false, error: "No image came back — try rephrasing." });
    return NextResponse.json({ ok: true, dataUrl });
  } catch (err) {
    console.error("[generate-image] failed:", err);
    return NextResponse.json({ ok: false, error: "Generation failed — try again." }, { status: 502 });
  }
}
