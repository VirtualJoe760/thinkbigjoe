import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db, activityLog } from "@/db";
import { uploadAudio } from "@/lib/blob";
import { findProspectByPhone } from "@/lib/forge-optout";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // upload + Gemini listen/summarize in one pass

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_DIALER_MODEL || "gemini-2.5-flash";
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Recording drop-box for Joe's Boost-phone dialer calls (NO Twilio in this path).
 *
 * The phone auto-uploads each finished call recording here (FolderSync → POST, filename intact).
 * We pull the lead's phone number out of the filename (Samsung/Cube ACR both embed it), match it
 * to a forge_sites lead, park the audio in Blob, then have Gemini LISTEN to the call and write
 * the sales notes — summary, objections, temperature, recommended next touch — onto the lead's
 * timeline (`dial_recording`, rendered with an audio player). Those notes are what the outreach
 * agent reads before composing the next follow-up, so every call Joe makes trains the cadence.
 *
 *   curl -X POST https://thinkbigjoe.com/api/dialer/recording \
 *     -H "Authorization: Bearer $DIALER_UPLOAD_KEY" \
 *     -F "file=@'Call recording +14806439089_260727_143321.m4a'"
 *
 * Auth: DIALER_UPLOAD_KEY (dedicated key so the phone never holds CRON_SECRET). Unmatched
 * numbers still store the audio + log an unattributed event — nothing is dropped silently.
 */
export async function POST(req: Request) {
  const expected = process.env.DIALER_UPLOAD_KEY;
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || got !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // FolderSync posts multipart; fall back to a raw body with ?name= for curl/testing.
  let bytes: Buffer;
  let filename: string;
  const ctype = req.headers.get("content-type") || "";
  if (ctype.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "no file field" }, { status: 400 });
    filename = file.name || "recording";
    bytes = Buffer.from(await file.arrayBuffer());
  } else {
    filename = new URL(req.url).searchParams.get("name") || "recording";
    bytes = Buffer.from(await req.arrayBuffer());
  }
  if (bytes.length < 2000) return NextResponse.json({ error: "empty file" }, { status: 400 });
  if (bytes.length > MAX_BYTES) return NextResponse.json({ error: "file too large" }, { status: 413 });

  const audioType = filename.endsWith(".amr") ? "audio/amr"
    : filename.endsWith(".mp3") ? "audio/mp3"
    : filename.endsWith(".ogg") ? "audio/ogg"
    : filename.endsWith(".wav") ? "audio/wav" : "audio/mp4";

  // The lead's number is the longest 10+ digit run in the filename (both recorder apps embed it).
  const digitRuns = filename.replace(/[^0-9]/g, " ").split(/\s+/).filter((d) => d.length >= 10);
  const phone = digitRuns.sort((a, b) => b.length - a.length)[0]?.slice(-10) || null;
  const prospect = phone ? await findProspectByPhone(phone).catch(() => null) : null;

  const { url } = await uploadAudio(bytes, {
    pathPrefix: `dialer/${prospect?.id ?? "unmatched"}`,
    contentType: audioType,
  });

  // Gemini listens to the call and writes the notes. Best-effort — audio is already safe in Blob.
  let notes: { summary?: string; objections?: string[]; temperature?: string; next_touch?: string } = {};
  if (GEMINI_KEY) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [
                { text: `This is a recorded sales call: Joe (ThinkBigJoe, a Web & AI agency — website previews + AI receptionist for local trades) calling the owner of ${prospect?.businessName || "a local service business"}. Listen and return STRICT JSON: {"summary": "2-3 sentences, what happened", "objections": ["each objection raised"], "temperature": "hot|warm|lukewarm|cold|no_contact", "next_touch": "one concrete recommended next step + angle"}. If it's voicemail/no conversation, say so in summary and use temperature no_contact.` },
                { inline_data: { mime_type: audioType, data: bytes.toString("base64") } },
              ],
            }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 500, responseMimeType: "application/json" },
          }),
          signal: AbortSignal.timeout(45000),
        },
      );
      if (res.ok) {
        const j = await res.json();
        const text = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "{}";
        notes = JSON.parse(text);
      } else {
        console.error("[dialer/recording] gemini", res.status, (await res.text().catch(() => "")).slice(0, 200));
      }
    } catch (err) {
      console.error("[dialer/recording] AI notes failed:", err);
    }
  }

  const noteText = [
    notes.summary,
    notes.objections?.length ? `Objections: ${notes.objections.join(" · ")}` : null,
    notes.next_touch ? `Next: ${notes.next_touch}` : null,
  ].filter(Boolean).join("\n");

  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "dial_recording",
    summary: `🎙️ Call recording — ${prospect?.businessName || phone || filename}${notes.temperature ? ` · ${notes.temperature}` : ""}`,
    metadata: {
      detail: {
        siteId: prospect?.id ?? null,
        channel: "call",
        note: noteText || null,
        recordingUrl: url,
        temperature: notes.temperature ?? null,
        filename,
      },
    },
  });

  // The AI's read also lands in contact_notes so call-prep and the outreach agent see it.
  if (prospect && noteText) {
    await db.execute(sql`
      UPDATE forge_sites SET contact_notes = COALESCE(contact_notes || E'\n', '') ||
             ${`[call ${new Date().toISOString().slice(0, 10)}] ${noteText.slice(0, 500)}`},
             updated_at = now()
      WHERE id = ${prospect.id}`);
  }

  return NextResponse.json({
    ok: true,
    matched: prospect ? { siteId: prospect.id, business: prospect.businessName } : null,
    recordingUrl: url,
    notes,
  });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "dialer/recording" });
}
