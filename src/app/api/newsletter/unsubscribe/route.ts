import { NextResponse } from "next/server";

import { unsubscribeByToken } from "@/lib/newsletter";

export const dynamic = "force-dynamic";

/** One-click unsubscribe (RFC 8058 List-Unsubscribe-Post). */
export async function POST(req: Request) {
  const t = new URL(req.url).searchParams.get("t") || "";
  await unsubscribeByToken(t);
  return NextResponse.json({ ok: true });
}

/** Link click — unsubscribe and show a simple confirmation page. */
export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") || "";
  const r = await unsubscribeByToken(t);
  const biz = r.business ? ` from ${r.business}` : "";
  const msg = r.ok
    ? `You've been unsubscribed${biz}. You won't receive any more newsletters.`
    : "We couldn't find that subscription — it may already be removed.";
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title></head>
  <body style="margin:0;background:#f5f7fb;font-family:Helvetica,Arial,sans-serif;color:#0a0a0b;">
    <div style="max-width:460px;margin:14vh auto;padding:32px;background:#fff;border:1px solid #e6e9ef;border-radius:16px;text-align:center;">
      <div style="font-size:40px;">✅</div>
      <h1 style="font-size:20px;margin:12px 0 8px;">Unsubscribed</h1>
      <p style="color:#5b616e;line-height:1.5;">${msg}</p>
    </div>
  </body></html>`;
  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html" } });
}
