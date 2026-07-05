// Vercel Domains Registrar API (v1/registrar/*) — search, price, buy, and attach
// domains for clients. Buying spends real money, so callers gate purchases to
// live mode via `domainsLiveMode()`. Read-only checks (availability/price) are
// always safe.

const API = "https://api.vercel.com";
const TOKEN = process.env.VERCEL_API_TOKEN;
const CLIENT_PROJECT_TEAM = process.env.VERCEL_TEAM_ID; // optional

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
}

/** True only when we're wired to actually charge + purchase (live Stripe). */
export function domainsLiveMode(): boolean {
  return Boolean(TOKEN) && (process.env.STRIPE_SECRET_KEY || "").startsWith("sk_live_");
}

export function domainsConfigured(): boolean {
  return Boolean(TOKEN);
}

export type DomainQuote = { domain: string; available: boolean; price: number | null };

/** Check availability + purchase price for a domain. Read-only. */
export async function quoteDomain(domain: string): Promise<DomainQuote> {
  if (!TOKEN) return { domain, available: false, price: null };
  const q = CLIENT_PROJECT_TEAM ? `?teamId=${CLIENT_PROJECT_TEAM}` : "";
  const availRes = await fetch(`${API}/v1/registrar/domains/${domain}/availability${q}`, {
    headers: authHeaders(),
  });
  const avail = availRes.ok ? await availRes.json() : { available: false };
  let price: number | null = null;
  if (avail.available) {
    const priceRes = await fetch(`${API}/v1/registrar/domains/${domain}/price${q}`, {
      headers: authHeaders(),
    });
    if (priceRes.ok) {
      const p = await priceRes.json();
      price = typeof p.purchasePrice === "number" ? p.purchasePrice : null;
    }
  }
  return { domain, available: Boolean(avail.available), price };
}

export type RegistrantContact = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string; // E.164, e.g. +14807642121
  address1: string;
  city: string;
  state: string;
  zip: string;
  country: string; // ISO 3166-1 alpha-2
};

/** TBJ's registrant contact from env (the account domains are registered under). */
export function registrantContact(): RegistrantContact | null {
  const c = {
    firstName: process.env.DOMAIN_REGISTRANT_FIRST_NAME,
    lastName: process.env.DOMAIN_REGISTRANT_LAST_NAME,
    email: process.env.DOMAIN_REGISTRANT_EMAIL,
    phone: process.env.DOMAIN_REGISTRANT_PHONE,
    address1: process.env.DOMAIN_REGISTRANT_ADDRESS1,
    city: process.env.DOMAIN_REGISTRANT_CITY,
    state: process.env.DOMAIN_REGISTRANT_STATE,
    zip: process.env.DOMAIN_REGISTRANT_ZIP,
    country: process.env.DOMAIN_REGISTRANT_COUNTRY,
  };
  return Object.values(c).every(Boolean) ? (c as RegistrantContact) : null;
}

/** Purchase a domain (real money). Returns the order id. */
export async function buyDomain(
  domain: string,
  expectedPrice: number,
  contact: RegistrantContact,
): Promise<{ orderId: string }> {
  const q = CLIENT_PROJECT_TEAM ? `?teamId=${CLIENT_PROJECT_TEAM}` : "";
  const res = await fetch(`${API}/v1/registrar/domains/${domain}/buy${q}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ autoRenew: true, years: 1, expectedPrice, contactInformation: contact }),
  });
  if (!res.ok) {
    throw new Error(`buy failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

/** Attach a domain to a Vercel project (best-effort; used after a purchase). */
export async function attachDomainToProject(project: string, domain: string): Promise<boolean> {
  const q = CLIENT_PROJECT_TEAM ? `?teamId=${CLIENT_PROJECT_TEAM}` : "";
  const res = await fetch(`${API}/v10/projects/${project}/domains${q}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ name: domain }),
  });
  return res.ok;
}

/** Derive a Vercel project name from a *.vercel.app live URL, if possible. */
export function projectFromLiveUrl(liveUrl: string | null): string | null {
  if (!liveUrl) return null;
  try {
    const host = new URL(liveUrl).host;
    const m = host.match(/^([^.]+)\.vercel\.app$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
