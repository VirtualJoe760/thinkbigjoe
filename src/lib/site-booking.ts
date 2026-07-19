/**
 * CLIENT booking — a customer books the BUSINESS, on the BUSINESS's own Google Calendar.
 *
 * Not to be confused with `src/lib/gcal.ts`, which is TBJ's OWN sales calendar (Joe's strategy
 * calls, Pacific time, his hours). This module never touches that: it acts purely with the site
 * owner's OAuth token, against their primary calendar and their contacts.
 *
 * This is what the Google `calendar.events` + `contacts` scopes are FOR, and what the verification
 * demo video shows:
 *   customer picks a slot → event created on the owner's calendar
 *                        → customer saved to the owner's Contacts under "Website Leads"
 *
 * Client sites are static (no backend), so they just link here — which is also how the previously
 * dead "Book & Pay Online" CTA becomes real.
 */
import { and, eq, ne } from "drizzle-orm";

import { db, forgeSites, activityLog } from "@/db";
import {
  createEventForClient,
  createGoogleContact,
  ensureContactGroup,
  getConnection,
  getValidAccessToken,
  googleContactExists,
  listCalendarEvents,
} from "@/lib/google-oauth";

/** The Contacts group every website customer lands in, so the owner can call them from their phone. */
export const WEBSITE_LEADS_GROUP = "Website Leads";

export const SITE_SLOT_MIN = 60;
export const SITE_MIN_NOTICE_MS = 2 * 60 * 60 * 1000; // 2 hours
export const SITE_ADVANCE_DAYS = 14;
/** Mon–Fri, 9am–5pm in the SITE's timezone. Sunday = index 0. */
const OPEN_HOUR = 9;
const CLOSE_HOUR = 17;
const OPEN_DAYS = [1, 2, 3, 4, 5];

export type BookableSite = {
  id: number;
  slug: string;
  businessName: string;
  ownerUserId: string;
  timezone: string;
};

/** How far `date` is from UTC in the given IANA zone, in ms (DST-aware). */
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value])) as Record<string, string>;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUTC - date.getTime();
}

/** A wall-clock time in `tz` → the real UTC instant. Two-pass so DST boundaries land correctly. */
function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = new Date(guess - tzOffsetMs(new Date(guess), tz));
  return new Date(guess - tzOffsetMs(first, tz));
}

/** Calendar parts of an instant as observed in `tz`. */
function partsIn(date: Date, tz: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value])) as Record<string, string>;
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, dow };
}

/** The site + its owner, if it can take bookings at all. */
export async function getBookableSite(slug: string): Promise<BookableSite | null> {
  const [s] = await db
    .select({
      id: forgeSites.id,
      slug: forgeSites.slug,
      businessName: forgeSites.businessName,
      ownerUserId: forgeSites.claimedByUserId,
      timezone: forgeSites.bookingTimezone,
    })
    .from(forgeSites)
    .where(and(eq(forgeSites.slug, slug), ne(forgeSites.status, "deleted")))
    .limit(1);
  if (!s?.ownerUserId) return null; // unclaimed sites have no calendar to book onto
  return { ...s, ownerUserId: s.ownerUserId };
}

/** The owner's Google access token, or null if they haven't connected Calendar. */
export async function ownerAccessToken(site: BookableSite): Promise<string | null> {
  const conn = await getConnection(site.ownerUserId);
  if (!conn?.calendarConnected) return null;
  return getValidAccessToken(conn);
}

/**
 * Open slots over the next SITE_ADVANCE_DAYS: business hours in the site's own timezone, minus
 * anything already on the owner's calendar. Returns ISO instants.
 */
export async function availableSlots(site: BookableSite, token: string): Promise<string[]> {
  const now = Date.now();
  const from = new Date(now);
  const to = new Date(now + SITE_ADVANCE_DAYS * 86400000);

  // null = we couldn't read the calendar (outage, expired token). Offering slots we can't verify
  // would book customers over the owner's existing appointments, so offer nothing instead.
  const events = await listCalendarEvents(token, from.toISOString(), to.toISOString());
  if (events === null) {
    console.error(`[site-booking] calendar unreadable for site ${site.id} — offering no slots`);
    return [];
  }

  const busy = events.map((e) => ({
    start: new Date(e.start).getTime(),
    end: new Date(e.end).getTime(),
  }));
  const overlaps = (s: number, e: number) => busy.some((b) => s < b.end && e > b.start);

  const out: string[] = [];
  for (let dayOffset = 0; dayOffset <= SITE_ADVANCE_DAYS; dayOffset++) {
    const probe = new Date(now + dayOffset * 86400000);
    const { y, m, d, dow } = partsIn(probe, site.timezone);
    if (!OPEN_DAYS.includes(dow)) continue;

    for (let hour = OPEN_HOUR; hour + SITE_SLOT_MIN / 60 <= CLOSE_HOUR; hour++) {
      const start = zonedToUtc(y, m, d, hour, 0, site.timezone);
      const s = start.getTime();
      const e = s + SITE_SLOT_MIN * 60000;
      if (s < now + SITE_MIN_NOTICE_MS) continue; // too soon
      if (overlaps(s, e)) continue;
      out.push(start.toISOString());
    }
  }
  return out;
}

export type BookingInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  startISO: string;
};

/**
 * Create the appointment on the owner's calendar, then save the customer to their Contacts.
 *
 * The contact write is deliberately NON-FATAL: if it fails (or they only granted Calendar), the
 * booking still stands. Losing the appointment because a contact couldn't be filed would be a far
 * worse failure than the owner having to add the number by hand.
 */
export async function bookForSite(
  site: BookableSite,
  token: string,
  input: BookingInput,
): Promise<{ ok: boolean; message: string; htmlLink?: string; contactSaved?: boolean }> {
  const start = new Date(input.startISO);
  if (Number.isNaN(start.getTime())) return { ok: false, message: "That time didn't look right." };
  const end = new Date(start.getTime() + SITE_SLOT_MIN * 60000);

  if (start.getTime() < Date.now() + SITE_MIN_NOTICE_MS) {
    return { ok: false, message: "That slot is too soon — please pick a later one." };
  }
  // Re-check against the live calendar: the slot list the customer saw may be stale.
  // A null read means we CANNOT confirm the slot is free — refuse rather than risk
  // double-booking the owner on top of a real appointment.
  const conflicts = await listCalendarEvents(token, start.toISOString(), end.toISOString());
  if (conflicts === null) {
    console.error(`[site-booking] calendar unreadable for site ${site.id} — refusing to book`);
    return { ok: false, message: "We couldn't confirm that time just now — please try again in a moment." };
  }
  const stillFree = !conflicts.some(
    (e) => new Date(e.start).getTime() < end.getTime() && new Date(e.end).getTime() > start.getTime(),
  );
  if (!stillFree) return { ok: false, message: "That time was just taken — please pick another." };

  const description = [
    `New booking from the ${site.businessName} website.`,
    ``,
    `Name: ${input.name}`,
    input.email ? `Email: ${input.email}` : null,
    input.phone ? `Phone: ${input.phone}` : null,
    input.notes ? `\nNotes:\n${input.notes}` : null,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const event = await createEventForClient(token, {
    summary: `${input.name} — booking`,
    description,
    start: { dateTime: start.toISOString(), timeZone: site.timezone },
    end: { dateTime: end.toISOString(), timeZone: site.timezone },
    ...(input.email ? { attendees: [{ email: input.email, displayName: input.name }] } : {}),
    reminders: { useDefault: true },
  });
  if (!event.ok) return { ok: false, message: "We couldn't add that to the calendar — please call us instead." };

  // Save the customer into the owner's Contacts under "Website Leads".
  let contactSaved = false;
  try {
    if (!(await googleContactExists(token, input.phone, input.email))) {
      const group = await ensureContactGroup(token, WEBSITE_LEADS_GROUP);
      contactSaved = await createGoogleContact(
        token,
        {
          name: input.name,
          email: input.email,
          phone: input.phone,
          notes: `Booked ${start.toISOString()} via the ${site.businessName} website.`,
        },
        group,
      );
    }
  } catch (err) {
    console.error("[site-booking] contact save failed (non-fatal):", err);
  }

  await db
    .insert(activityLog)
    .values({
      actor: "website",
      eventType: "site_booking_made",
      summary: `${input.name} booked ${site.businessName}`,
      metadata: { auto: true, target: site.slug, detail: { siteId: site.id, startISO: input.startISO, contactSaved } },
    })
    .catch(() => {});

  return { ok: true, message: "Booked", htmlLink: event.htmlLink, contactSaved };
}
