// Image generation via Google Gemini ("Nano Banana") — same model the forge uses
// (gen-image.mjs). Generates or refines an image from a text prompt, optionally
// conditioned on a reference image (e.g. the client's current logo).
const MODEL = "gemini-2.5-flash-image";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY);
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

/** Fetch a reference image URL and return { mime, base64 }, or null. */
async function fetchRef(url: string): Promise<{ mime: string; data: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mime = res.headers.get("content-type") || "image/png";
    if (!mime.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 4_000_000) return null; // keep the request sane
    return { mime, data: buf.toString("base64") };
  } catch {
    return null;
  }
}

/**
 * Generate or edit an image; returns a data URL (data:image/...;base64,...) or null.
 * `ref` (optional) — an existing image to condition on / edit; may be an https URL
 * OR a data: URL (e.g. the current studio canvas).
 */
export async function generateImage(prompt: string, ref?: string, aspect?: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  if (!key) return null;

  const parts: Part[] = [{ text: prompt }];
  if (ref) {
    let inline: { mime: string; data: string } | null = null;
    if (ref.startsWith("data:")) {
      const m = ref.match(/^data:([^;]+);base64,(.+)$/);
      if (m && Buffer.byteLength(m[2], "base64") <= 6_000_000) inline = { mime: m[1], data: m[2] };
    } else if (/^https?:\/\//.test(ref)) {
      inline = await fetchRef(ref);
    }
    if (inline) parts.push({ inline_data: { mime_type: inline.mime, data: inline.data } });
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts }],
      // aspectRatio matters for logos: without it Gemini defaults to a 1024² square, which
      // makes a horizontal lockup render tiny in a navbar. 21:9 = wide lockup, 1:1 = circular.
      generationConfig: {
        responseModalities: ["IMAGE"],
        ...(aspect ? { imageConfig: { aspectRatio: aspect } } : {}),
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = await res.json();
  const cand = json?.candidates?.[0]?.content?.parts || [];
  const img = cand.find((p: Record<string, unknown>) => p.inlineData || p.inline_data);
  if (!img) return null;
  const d = (img.inlineData || img.inline_data) as { mimeType?: string; mime_type?: string; data: string };
  return `data:${d.mimeType || d.mime_type || "image/png"};base64,${d.data}`;
}
