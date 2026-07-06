import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { desc } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";

export const dynamic = "force-dynamic";

const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
  "VA", "WA", "WV", "WI", "WY", "DC",
]);
function stateFrom(s: string): string {
  const tokens = (s || "").toUpperCase().match(/\b[A-Z]{2}\b/g);
  if (!tokens) return "";
  for (let i = tokens.length - 1; i >= 0; i--) if (US_STATES.has(tokens[i])) return tokens[i];
  return "";
}

/**
 * CSV export of forge leads for calling / CRM import (GoHighLevel imports CSV directly).
 * Admin only. Optional ?status=built|discovered|... filter.
 */
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user || !isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = new URL(req.url).searchParams.get("status");
  const rows = await db.select().from(forgeSites).orderBy(desc(forgeSites.createdAt));
  const leads = status ? rows.filter((r) => r.status === status) : rows.filter((r) => r.status !== "denied");

  type Row = (typeof rows)[number];
  const cols: Array<[string, (r: Row) => string | null | undefined]> = [
    ["Business", (r) => r.businessName],
    ["Owner", (r) => r.ownerName],
    ["Phone", (r) => r.phone],
    ["Email", (r) => r.email],
    ["Status", (r) => r.status],
    ["Niche", (r) => r.niche],
    ["City", (r) => (r.city || "").replace(/,\s*[A-Za-z]{2}\s*$/, "").trim()],
    ["State", (r) => stateFrom(r.serviceArea || "") || stateFrom(r.city || "")],
    ["Service area", (r) => r.serviceArea],
    ["Instagram", (r) => r.instagramUrl],
    ["Facebook", (r) => r.facebookUrl],
    ["LinkedIn", (r) => r.linkedinUrl],
    ["Google Maps", (r) => r.googleMapsUrl],
    ["Existing site", (r) => r.existingWebsiteUrl],
    ["Our site", (r) => r.liveUrl],
    ["Google rating", (r) => r.googleRating],
    ["Reviews", (r) => r.reviewCount],
    ["Claim code", (r) => r.claimCode],
    ["Outreach", (r) => r.outreachStatus],
    ["Notes", (r) => r.contactNotes],
    ["Fit reason", (r) => r.fitReason],
  ];

  const esc = (v: string | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map((c) => c[0]).join(",")];
  for (const r of leads) lines.push(cols.map((c) => esc(c[1](r))).join(","));
  const csv = "﻿" + lines.join("\r\n"); // BOM so Excel/Sheets read UTF-8

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tbj-leads${status ? `-${status}` : ""}.csv"`,
    },
  });
}
