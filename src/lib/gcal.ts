/**
 * Google Calendar client for the strategy-call booking flow.
 *
 * Ported from jpsrealtor's gcal-api.ts, simplified to single-tenant: this site
 * books onto Joe's calendar (the same one jpsrealtor uses), so availability is
 * shared across both sites. Credentials come from env:
 *   GCAL_CLIENT_ID / GCAL_CLIENT_SECRET  — OAuth client the refresh token is bound to
 *   GCAL_REFRESH_TOKEN                   — Joe's calendar refresh token
 *   GCAL_CALENDAR_ID                     — usually "primary"
 */

// ── Booking rules (mirrors Joe's settings in jpsrealtor) ──────────────────────

export const BOOKING_TIMEZONE = "America/Los_Angeles";
export const SLOT_DURATION_MIN = 30;
// 30-min buffer → slots land on clean top-of-hour times (10, 11, 1, 2, 3) rather
// than odd offsets, and leaves the host breathing room between calls.
export const SLOT_BUFFER_MIN = 30;
export const ADVANCE_BOOKING_DAYS = 30;
/** Minimum notice before a slot can be booked (ms). */
export const MIN_NOTICE_MS = 3 * 60 * 60 * 1000; // 3 hours

/**
 * Sales-call windows in 24h clock, per weekday (0 = Sunday). null = closed.
 * Joe's booking hours: 10am–4pm Pacific, weekdays, with a midday lunch break
 * (see LUNCH_BREAK) that removes the noon slot. Weekends stay closed.
 */
export type DayHours = { open: [number, number]; close: [number, number] };

const WEEKDAY_HOURS: DayHours = { open: [10, 0], close: [16, 0] };

/** Lunch — no appointments book in this window (Pacific), applied to every open day. */
export const LUNCH_BREAK: { start: [number, number]; end: [number, number] } = { start: [12, 0], end: [13, 0] };

/** Agentic ($999) strategy calls share the standard 10am–4pm weekday window. Passed as an
 *  override to getAvailableSlots; weekends stay closed regardless (BUSINESS_HOURS gates the day). */
export const AGENTIC_HOURS: DayHours = WEEKDAY_HOURS;

const BUSINESS_HOURS: Array<DayHours | null> = [
  null, //          Sunday — closed
  WEEKDAY_HOURS, // Monday
  WEEKDAY_HOURS, // Tuesday
  WEEKDAY_HOURS, // Wednesday
  WEEKDAY_HOURS, // Thursday
  WEEKDAY_HOURS, // Friday
  null, //          Saturday — closed
];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees?: Array<{ email: string; displayName?: string }>;
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{ method: "email" | "popup"; minutes: number }>;
  };
  conferenceData?: unknown;
  status?: string;
  htmlLink?: string;
  hangoutLink?: string; // Google Meet URL (present when conferenceData was requested)
}

/** Pull the Google Meet URL out of a created event (top-level hangoutLink, else conferenceData entry). */
export function meetLinkOf(event: CalendarEvent): string | null {
  if (event.hangoutLink) return event.hangoutLink;
  const cd = event.conferenceData as { entryPoints?: Array<{ entryPointType?: string; uri?: string }> } | undefined;
  const video = cd?.entryPoints?.find((e) => e.entryPointType === "video" && e.uri);
  return video?.uri || null;
}

/** The calendar/Google-Meet host — `GCAL_CALENDAR_ID` (defaults to the connected account's primary).
 *  Change this env var to move bookings + the Meet to a different calendar/email. */
export function bookingHost(): string {
  return process.env.GCAL_CALENDAR_ID || "primary";
}

export interface TimeSlot {
  start: string; // ISO
  end: string; // ISO
}

interface FreeBusySlot {
  start: string;
  end: string;
}

// ── Config / auth ─────────────────────────────────────────────────────────────

export function isCalendarConfigured(): boolean {
  return Boolean(
    process.env.GCAL_CLIENT_ID &&
      process.env.GCAL_CLIENT_SECRET &&
      process.env.GCAL_REFRESH_TOKEN,
  );
}

function calendarId(): string {
  return process.env.GCAL_CALENDAR_ID || "primary";
}

// In-memory access-token cache (per server instance), refreshed with 60s buffer.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const params = new URLSearchParams({
    client_id: process.env.GCAL_CLIENT_ID || "",
    client_secret: process.env.GCAL_CLIENT_SECRET || "",
    refresh_token: process.env.GCAL_REFRESH_TOKEN || "",
    grant_type: "refresh_token",
  });

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!resp.ok) {
    const err = await resp.text();
    console.error("[gcal] token refresh failed:", err);
    throw new Error(`Google Calendar token refresh failed: ${resp.status}`);
  }
  const data = await resp.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000 - 60_000,
  };
  return data.access_token;
}

const BASE_URL = "https://www.googleapis.com/calendar/v3";

async function gcalFetch(
  url: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  body?: Record<string, unknown>,
): Promise<any> {
  const accessToken = await getAccessToken();
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(
      `Google Calendar API error (${resp.status}): ${JSON.stringify(errorData)}`,
    );
  }
  if (resp.status === 204) return null;
  return resp.json();
}

// ── API methods ───────────────────────────────────────────────────────────────

/**
 * Create an event. sendUpdates=all makes Google email the attendee a calendar
 * invite; conferenceDataVersion=1 allows attaching a Google Meet link.
 */
export async function createEvent(
  event: Omit<CalendarEvent, "id">,
): Promise<CalendarEvent> {
  return gcalFetch(
    `${BASE_URL}/calendars/${encodeURIComponent(calendarId())}/events?sendUpdates=all&conferenceDataVersion=1`,
    "POST",
    event as unknown as Record<string, unknown>,
  );
}

/**
 * Live connection check for the command overview — confirms the refresh token
 * still works by doing a tiny free/busy ping. `configured` = env vars present;
 * `ok` = an actual API call succeeded (token valid, not revoked).
 */
export async function calendarHealth(): Promise<{ configured: boolean; ok: boolean; calendarId?: string; error?: string }> {
  if (!isCalendarConfigured()) return { configured: false, ok: false };
  try {
    const now = new Date();
    // Time-box so a slow/hung Google API can't stall the overview page.
    await Promise.race([
      getFreeBusy(now.toISOString(), new Date(now.getTime() + 3600_000).toISOString()),
      new Promise((_, reject) => setTimeout(() => reject(new Error("health check timed out")), 6000)),
    ]);
    return { configured: true, ok: true, calendarId: calendarId() };
  } catch (err) {
    return { configured: true, ok: false, calendarId: calendarId(), error: err instanceof Error ? err.message : "unknown error" };
  }
}

async function getFreeBusy(timeMin: string, timeMax: string): Promise<FreeBusySlot[]> {
  const id = calendarId();
  const result = await gcalFetch(`${BASE_URL}/freeBusy`, "POST", {
    timeMin,
    timeMax,
    items: [{ id }],
  });
  return result.calendars?.[id]?.busy || [];
}

// ── Timezone-safe wall-clock → UTC ────────────────────────────────────────────

/**
 * Convert a wall-clock time in BOOKING_TIMEZONE to a UTC Date, DST-safe.
 * (jpsrealtor parses times in the server's local zone, which breaks on UTC
 * servers — this version is correct anywhere.)
 */
function zonedTimeToUtc(dateStr: string, hour: number, minute: number): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const desired = Date.UTC(y, m - 1, d, hour, minute, 0);
  let utc = desired;
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: BOOKING_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
        .formatToParts(new Date(utc))
        .map((p) => [p.type, p.value]),
    );
    const shown = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second),
    );
    utc += desired - shown;
  }
  return new Date(utc);
}

/** Weekday (0=Sun) of a YYYY-MM-DD as observed in BOOKING_TIMEZONE. */
function weekdayInZone(dateStr: string): number {
  // Noon UTC is the same calendar day in any UTC±12 zone.
  const [y, m, d] = dateStr.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: BOOKING_TIMEZONE,
    weekday: "short",
  }).format(noon);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

// ── Slot generation (same algorithm as jpsrealtor) ────────────────────────────

export async function getAvailableSlots(
  dateStr: string, // YYYY-MM-DD
  durationMinutes: number = SLOT_DURATION_MIN,
  hoursOverride?: DayHours, // widen the weekday window (e.g. AGENTIC_HOURS); weekends still closed
): Promise<TimeSlot[]> {
  const dayHours = BUSINESS_HOURS[weekdayInZone(dateStr)];
  if (!dayHours) return []; // weekend / closed day — override never opens a closed day
  const hours = hoursOverride ?? dayHours;

  const openTime = zonedTimeToUtc(dateStr, hours.open[0], hours.open[1]);
  const closeTime = zonedTimeToUtc(dateStr, hours.close[0], hours.close[1]);
  const breakStart = zonedTimeToUtc(dateStr, LUNCH_BREAK.start[0], LUNCH_BREAK.start[1]).getTime();
  const breakEnd = zonedTimeToUtc(dateStr, LUNCH_BREAK.end[0], LUNCH_BREAK.end[1]).getTime();

  let busySlots: FreeBusySlot[] = [];
  try {
    busySlots = await getFreeBusy(openTime.toISOString(), closeTime.toISOString());
  } catch (err) {
    console.error("[gcal] free/busy lookup failed:", err);
    // Fail closed: rather than offering slots that might double-book, offer none.
    return [];
  }

  const earliestStart = Date.now() + MIN_NOTICE_MS;
  const slots: TimeSlot[] = [];
  let current = new Date(openTime);

  while (current.getTime() + durationMinutes * 60000 <= closeTime.getTime()) {
    const slotEnd = new Date(current.getTime() + durationMinutes * 60000);

    const isBusy = busySlots.some((busy) => {
      const busyStart = new Date(busy.start).getTime();
      const busyEnd = new Date(busy.end).getTime();
      return current.getTime() < busyEnd && slotEnd.getTime() > busyStart;
    });
    const inLunch = current.getTime() < breakEnd && slotEnd.getTime() > breakStart;

    if (!isBusy && !inLunch && current.getTime() >= earliestStart) {
      slots.push({ start: current.toISOString(), end: slotEnd.toISOString() });
    }

    current = new Date(current.getTime() + (durationMinutes + SLOT_BUFFER_MIN) * 60000);
  }

  return slots;
}

/** Re-check a specific window is still free right before booking. */
export async function isWindowFree(startISO: string, endISO: string): Promise<boolean> {
  const busy = await getFreeBusy(startISO, endISO);
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  return !busy.some((b) => {
    const bs = new Date(b.start).getTime();
    const be = new Date(b.end).getTime();
    return start < be && end > bs;
  });
}
