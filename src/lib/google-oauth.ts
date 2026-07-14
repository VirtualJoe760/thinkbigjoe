import { eq } from "drizzle-orm";

import { db, googleConnections } from "@/db";

/**
 * Per-CLIENT Google OAuth — lets a portal customer connect their own Google account so their
 * receptionist books into their calendar and their contacts sync into the newsletter list. Reuses
 * the existing GCAL OAuth client (GCAL_CLIENT_ID/SECRET); tokens are stored per user in
 * `google_connections` (distinct from Joe's single-account GCAL_REFRESH_TOKEN in env).
 *
 * ⚠️ Requires (in the Google Cloud OAuth client): the redirect URI `${SITE}/api/google/callback`
 * whitelisted, the Calendar + People (Contacts) APIs enabled, and those scopes on the consent
 * screen (which is "in production" so any client can authorize — sensitive scopes may need review).
 */
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com").replace(/\/+$/, "");
const CLIENT_ID = process.env.GCAL_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GCAL_CLIENT_SECRET || "";
export const GOOGLE_REDIRECT_URI = `${SITE}/api/google/callback`;

export const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/calendar.events", // book/read appointments
  "https://www.googleapis.com/auth/contacts", // read (newsletter sync) + write (TBJ label groups)
];

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

/** The Google consent URL. `state` carries our CSRF token + which user/site is connecting. */
export function buildAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline", // get a refresh_token
    prompt: "consent", // force refresh_token even on re-connect
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  id_token?: string;
};

/** Exchange the callback `code` for tokens. */
export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

/** The Google account email behind an access token (for display + the connection record). */
export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const j = await res.json();
    return j.email || null;
  } catch {
    return null;
  }
}

/** Upsert the connection for a user (one Google account per portal user). */
export async function storeConnection(input: {
  userId: string;
  siteId: number | null;
  tokens: TokenResponse;
  googleEmail: string | null;
}): Promise<void> {
  const scopes = input.tokens.scope || "";
  const expiry = new Date(Date.now() + (input.tokens.expires_in || 3600) * 1000).toISOString();
  const row = {
    userId: input.userId,
    siteId: input.siteId,
    googleEmail: input.googleEmail,
    accessToken: input.tokens.access_token,
    scope: scopes,
    tokenExpiry: expiry,
    calendarConnected: /calendar/.test(scopes),
    contactsConnected: /contacts/.test(scopes),
    updatedAt: new Date().toISOString(),
    // Only overwrite the refresh_token when Google returns a new one (it omits it on silent re-auth).
    ...(input.tokens.refresh_token ? { refreshToken: input.tokens.refresh_token } : {}),
  };
  await db
    .insert(googleConnections)
    .values(row)
    .onConflictDoUpdate({ target: googleConnections.userId, set: row });
}

export type GoogleConnection = typeof googleConnections.$inferSelect;

export async function getConnection(userId: string): Promise<GoogleConnection | null> {
  const [c] = await db.select().from(googleConnections).where(eq(googleConnections.userId, userId)).limit(1);
  return c ?? null;
}

/** A valid access token for a connection, refreshing (and persisting) it if it's expired/expiring. */
export async function getValidAccessToken(conn: GoogleConnection): Promise<string | null> {
  const expiresAt = conn.tokenExpiry ? new Date(conn.tokenExpiry).getTime() : 0;
  if (conn.accessToken && expiresAt > Date.now() + 60_000) return conn.accessToken;
  if (!conn.refreshToken) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: conn.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    console.error("[google-oauth] refresh failed:", conn.userId, res.status);
    return null;
  }
  const data = (await res.json()) as TokenResponse;
  const expiry = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
  await db
    .update(googleConnections)
    .set({ accessToken: data.access_token, tokenExpiry: expiry, updatedAt: new Date().toISOString() })
    .where(eq(googleConnections.userId, conn.userId));
  return data.access_token;
}

export type ClientCalEvent = {
  id: string; summary: string; description: string; start: string; end: string;
  allDay: boolean; hangoutLink: string | null; htmlLink: string | null; location: string | null;
};

/** List a client's primary-calendar events (using their token). Returns [] on any error. */
export async function listCalendarEvents(accessToken: string, timeMinISO: string, timeMaxISO: string): Promise<ClientCalEvent[]> {
  try {
    const url =
      `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
      `?singleEvents=true&orderBy=startTime&maxResults=150` +
      `&timeMin=${encodeURIComponent(timeMinISO)}&timeMax=${encodeURIComponent(timeMaxISO)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return [];
    const data = await res.json();
    return ((data.items || []) as any[])
      .filter((e) => e.status !== "cancelled" && (e.start?.dateTime || e.start?.date))
      .map((e) => ({
        id: String(e.id),
        summary: e.summary || "(no title)",
        description: e.description || "",
        start: e.start.dateTime || e.start.date,
        end: e.end?.dateTime || e.end?.date || e.start.dateTime || e.start.date,
        allDay: !!e.start.date,
        hangoutLink: e.hangoutLink || null,
        htmlLink: e.htmlLink || null,
        location: e.location || null,
      }));
  } catch {
    return [];
  }
}

// ── Google Contacts (People API) ────────────────────────────────────────────

export type GoogleContact = { name: string | null; email: string | null; phone: string | null };

/** Read a user's Google Contacts (names + emails + phones). Paginates. Returns [] on error. */
export async function listGoogleContacts(accessToken: string): Promise<GoogleContact[]> {
  const out: GoogleContact[] = [];
  let pageToken: string | undefined;
  try {
    do {
      const p = new URLSearchParams({ personFields: "names,emailAddresses,phoneNumbers", pageSize: "500" });
      if (pageToken) p.set("pageToken", pageToken);
      const res = await fetch(`https://people.googleapis.com/v1/people/me/connections?${p.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) break;
      const data = await res.json();
      for (const person of (data.connections || []) as any[]) {
        out.push({
          name: person.names?.[0]?.displayName ?? null,
          email: person.emailAddresses?.[0]?.value ?? null,
          phone: person.phoneNumbers?.[0]?.value ?? null,
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken && out.length < 5000);
  } catch (err) {
    console.error("[google-oauth] listGoogleContacts:", err);
  }
  return out;
}

/** Find (or create) a named contact group, returning its resourceName (e.g. "contactGroups/xxxx"). */
export async function ensureContactGroup(accessToken: string, name: string): Promise<string | null> {
  try {
    const list = await fetch("https://people.googleapis.com/v1/contactGroups?pageSize=200", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (list.ok) {
      const data = await list.json();
      const found = (data.contactGroups || []).find((g: any) => g.name === name || g.formattedName === name);
      if (found?.resourceName) return found.resourceName;
    }
    const create = await fetch("https://people.googleapis.com/v1/contactGroups", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contactGroup: { name } }),
    });
    if (!create.ok) return null;
    return (await create.json()).resourceName || null;
  } catch {
    return null;
  }
}

/** Create a contact (optionally in a group). Returns true on success. */
export async function createGoogleContact(
  accessToken: string,
  c: { name?: string | null; email?: string | null; phone?: string | null; notes?: string | null },
  groupResourceName?: string | null,
): Promise<boolean> {
  const body: Record<string, unknown> = {};
  if (c.name) body.names = [{ givenName: c.name }];
  if (c.email) body.emailAddresses = [{ value: c.email }];
  if (c.phone) body.phoneNumbers = [{ value: c.phone }];
  if (c.notes) body.biographies = [{ value: c.notes, contentType: "TEXT_PLAIN" }];
  if (groupResourceName) body.memberships = [{ contactGroupMembership: { contactGroupResourceName: groupResourceName } }];
  try {
    const res = await fetch("https://people.googleapis.com/v1/people:createContact", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** True if a contact with this phone (last 10 digits) or email already exists — dedupe before create. */
export async function googleContactExists(accessToken: string, phone?: string | null, email?: string | null): Promise<boolean> {
  const q = (email || phone || "").trim();
  if (!q) return false;
  try {
    const p = new URLSearchParams({ query: q, readMask: "emailAddresses,phoneNumbers", pageSize: "5" });
    const res = await fetch(`https://people.googleapis.com/v1/people:searchContacts?${p.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return false;
    const data = await res.json();
    return (data.results || []).length > 0;
  } catch {
    return false;
  }
}

/** Create an event in a user's OWN primary calendar (their receptionist books here). */
export async function createEventForClient(accessToken: string, event: Record<string, unknown>): Promise<{ ok: boolean; htmlLink?: string; hangoutLink?: string }> {
  try {
    const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all&conferenceDataVersion=1", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    return { ok: true, htmlLink: data.htmlLink, hangoutLink: data.hangoutLink };
  } catch {
    return { ok: false };
  }
}

/** Forget a connection (client disconnects). Best-effort revoke, then delete the row. */
export async function disconnectGoogle(userId: string): Promise<void> {
  const conn = await getConnection(userId);
  if (conn?.refreshToken) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(conn.refreshToken)}`, { method: "POST" }).catch(() => {});
  }
  await db.delete(googleConnections).where(eq(googleConnections.userId, userId));
}
