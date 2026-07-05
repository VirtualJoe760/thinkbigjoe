import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";

import { db, forgeSites, editRequests } from "@/db";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { notifyTelegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";

type EditChanges = {
  newText?: string;
  color?: string;
  background?: string;
  image?: { name?: string; dataUrl?: string };
  note?: string;
};
type Edit = { selector?: string; tag?: string; text?: string; changes?: EditChanges; note?: string };

/** Receives the batch of click-to-edit requests from editor.js, stores them as
 *  markdown for the forge to apply. Called same-origin from the injected editor. */
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: { siteId?: number; edits?: Edit[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  const siteId = Number(body.siteId);
  const edits = Array.isArray(body.edits) ? body.edits : [];
  if (!Number.isFinite(siteId) || edits.length === 0) {
    return NextResponse.json({ ok: false, error: "nothing to save" }, { status: 400 });
  }

  const [site] = await db.select().from(forgeSites).where(eq(forgeSites.id, siteId)).limit(1);
  if (!site) return NextResponse.json({ ok: false, error: "site not found" }, { status: 404 });
  const owns = site.claimedByUserId === session.user.id || isAdminEmail(session.user.email);
  if (!owns) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const lines = [
    `# Edit request — ${site.businessName}`,
    `Site: ${site.domain || site.liveUrl || site.slug}`,
    `Requested by: ${session.user.email}`,
    ``,
  ];
  let imageCount = 0;
  edits.forEach((e, i) => {
    const c = e.changes || {};
    lines.push(`${i + 1}. **${e.tag || "element"}**${e.text ? ` — “${e.text}”` : ""}`);
    if (c.newText) lines.push(`   - New text: “${c.newText}”`);
    if (c.color) lines.push(`   - Text color → ${c.color}`);
    if (c.background) lines.push(`   - Background → ${c.background}`);
    if (c.image?.dataUrl) {
      imageCount++;
      lines.push(`   - Replace image/logo with uploaded file: ${c.image.name || "image"} (attached in data)`);
    }
    const note = c.note || e.note;
    if (note) lines.push(`   - Note: ${note}`);
    if (e.selector) lines.push(`   - Selector: \`${e.selector}\``);
    lines.push(``);
  });
  if (imageCount) lines.push(`_${imageCount} uploaded image(s) stored with this request (in the edits data)._`);
  const markdown = lines.join("\n");

  await db.insert(editRequests).values({
    siteId,
    requestedByUserId: session.user.id,
    markdown,
    edits: edits,
    status: "requested",
  });

  notifyTelegram(
    `✏️ <b>Edit request</b> — ${site.businessName}\n${edits.length} change(s) from ${session.user.email}`,
  ).catch(() => {});

  return NextResponse.json({ ok: true, count: edits.length });
}
