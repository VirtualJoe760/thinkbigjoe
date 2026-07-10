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
  replaceGraphic?: boolean;
  variant?: string;
  note?: string;
  // Brand-theme (token) change — moves the template's design tokens.
  primaryHex?: string;
  brandH?: number;
  brandC?: number;
  secondaryHex?: string;
  accentH?: number;
  font?: string;
  fontId?: string;
  fontGoogle?: string;
  fontHeadingStack?: string;
  fontSansStack?: string;
  clear?: boolean; // a Revert — wipe the saved theme
  clearFont?: boolean; // the reverted theme had a font wired — needs LLM to un-wire next/font
  semantic?: Record<string, string>; // element→token color edits: { "--color-foreground": "#hex" }
};
type Edit = { kind?: string; selector?: string; tag?: string; text?: string; section?: string; changes?: EditChanges; note?: string };

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
    // Brand theme change — move the template's OWN design tokens so the whole OKLCH ramp
    // shifts (NOT per-element styles). These land in the site's `app/globals.css` :root.
    if (e.kind === "token") {
      if (c.clear) {
        lines.push(`${i + 1}. **Revert brand to original** — remove the fenced \`/* TBJ-THEME-START */ … /* TBJ-THEME-END */\` block from \`app/globals.css\` (restores the template's default brand colors).`);
        if (c.clearFont) lines.push(`   - Also un-wire the custom font: remove the added \`next/font\` import from \`app/layout.tsx\` and restore the template's default \`--font-heading-stack\` / \`--font-sans-stack\`.`);
        lines.push(``);
        return;
      }
      lines.push(`${i + 1}. **Brand theme change** — edit the design tokens in \`app/globals.css\` \`:root\` (do NOT restyle individual elements; move the tokens so it applies site-wide):`);
      if (c.brandH != null) lines.push(`   - Primary color → \`--brand-h: ${c.brandH};\`${c.brandC != null ? ` \`--brand-c: ${c.brandC};\`` : ""}  (picked ${c.primaryHex})`);
      if (c.accentH != null) lines.push(`   - Secondary / accent → \`--accent-h: ${c.accentH};\`  (picked ${c.secondaryHex})`);
      if (c.font) lines.push(`   - Font "${c.font}" → import via \`next/font/google\` in \`app/layout.tsx\` (Google families: \`${c.fontGoogle}\`), then point \`--font-heading-stack\` / \`--font-sans-stack\` at the next/font CSS variables (fallback stacks: \`${c.fontHeadingStack}\` / \`${c.fontSansStack}\`)`);
      lines.push(``);
      return;
    }
    // Section / layout change (forge swaps a @webdev/ui variant prop or builds it).
    if (e.section || e.tag === "section") {
      lines.push(`${i + 1}. **Section: ${e.text || e.section}**`);
      if (c.variant) lines.push(`   - Switch layout to variant **"${c.variant}"** (the @webdev/ui \`variant\` prop in app/page.tsx)`);
      const snote = c.note || e.note;
      if (snote) lines.push(`   - Requested change: ${snote}`);
      if (e.selector) lines.push(`   - Section element: \`${e.selector}\``);
      lines.push(``);
      return;
    }
    lines.push(`${i + 1}. **${e.tag || "element"}**${e.text ? ` — “${e.text}”` : ""}`);
    if (c.newText) lines.push(`   - New text: “${c.newText}”`);
    if (c.color) lines.push(`   - Text color (this element only) → ${c.color}`);
    if (c.background) lines.push(`   - Background (this element only) → ${c.background}`);
    if (c.semantic) for (const [k, v] of Object.entries(c.semantic)) lines.push(`   - Brand token \`${k}: ${v};\` — recolors everywhere this token is used. **Applied automatically** to the fenced TBJ-THEME block in \`app/globals.css\`; no manual edit needed.`);
    if (c.image?.dataUrl) {
      imageCount++;
      if (c.replaceGraphic) lines.push(`   - Replace this icon/graphic with the uploaded image: ${c.image.name || "image"} (attached in data)`);
      else lines.push(`   - Replace image/logo with uploaded file: ${c.image.name || "image"} (attached in data)`);
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

  // Durably save the theme NOW (before the forge bakes it), so the proxy + portal reflect it
  // on reopen and it survives rebuilds + template swaps. Merge into existing overrides; a
  // `clear` token edit (Revert) wipes them.
  const tokenEdit = edits.find((e) => e.kind === "token");
  // Element→token color edits carry a semantic map on a normal element edit — collect them all.
  const semanticPatch: Record<string, string> = {};
  for (const e of edits) {
    const s = e.changes?.semantic;
    if (s && typeof s === "object") for (const [k, v] of Object.entries(s)) {
      if (/^--[a-z0-9-]+$/i.test(k) && typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v)) semanticPatch[k] = v;
    }
  }
  if (tokenEdit || Object.keys(semanticPatch).length > 0) {
    const tc = tokenEdit?.changes || {};
    if (tc.clear) {
      await db.update(forgeSites).set({ themeOverrides: null }).where(eq(forgeSites.id, siteId));
    } else {
      const prev = (site.themeOverrides as Record<string, unknown> | null) || {};
      const patch: Record<string, unknown> = { ...prev };
      if (Object.keys(semanticPatch).length > 0) patch.semantic = { ...((prev.semantic as Record<string, string>) || {}), ...semanticPatch };
      if (tc.primaryHex != null) patch.primaryHex = tc.primaryHex;
      if (tc.brandH != null) patch.brandH = tc.brandH;
      if (tc.brandC != null) patch.brandC = tc.brandC;
      if (tc.secondaryHex != null) patch.secondaryHex = tc.secondaryHex;
      if (tc.accentH != null) patch.accentH = tc.accentH;
      if (tc.font != null) patch.font = tc.font;
      if (tc.fontId != null) patch.fontId = tc.fontId;
      if (tc.fontGoogle != null) patch.fontGoogle = tc.fontGoogle;
      if (tc.fontHeadingStack != null) patch.fontHeadingStack = tc.fontHeadingStack;
      if (tc.fontSansStack != null) patch.fontSansStack = tc.fontSansStack;
      await db.update(forgeSites).set({ themeOverrides: patch }).where(eq(forgeSites.id, siteId));
    }
  }

  notifyTelegram(
    `✏️ <b>Edit request</b> — ${site.businessName}\n${edits.length} change(s) from ${session.user.email}`,
  ).catch(() => {});

  return NextResponse.json({ ok: true, count: edits.length });
}
