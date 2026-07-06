// Existing-site analyzer — given any website URL, fetch it server-side and pull
// out the pieces the forge needs to rebuild/inspire: business details, brand
// (logo, colors, fonts), content (services, tone), and media (hero, gallery).
//
// Zero-dependency HTML parsing (matches the house style in api/site-assets) plus
// an optional Gemini text pass to synthesize niche/tone/services from the copy.
// Output normalizes to the forge's business.json shape so an analysis can drop
// straight into a build. Handles static/SSR sites (Wix, Squarespace, WordPress,
// GoDaddy, Webflow) — most small-business sites. JS-only SPAs get thinner results.

export type SocialLink = { label: string; url: string };

export type SiteAnalysis = {
  url: string;
  finalUrl: string;
  ok: boolean;
  error?: string;
  business: {
    name?: string;
    description?: string;
    phone?: string;
    email?: string;
    address?: string;
    hours?: string;
    niche?: string;
    tone?: string;
    services: string[];
    differentiators: string[];
  };
  brand: {
    logoUrl?: string;
    colors: string[]; // hex, most prominent first
    fonts: string[];
    themeColor?: string;
    suggestedBrandColor?: string;
  };
  socials: SocialLink[];
  media: { hero?: string; images: string[] };
  meta: {
    title?: string;
    ogImage?: string;
    platform?: string; // Wix / Squarespace / WordPress / …
    pagesFetched: string[];
  };
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 thinkbigjoe-analyzer";

/** Reject obviously-internal hosts (basic SSRF guard). */
function isPublicHttpUrl(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const h = url.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local")) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    if (h === "::1" || h === "[::1]") return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string } | null> {
  if (!isPublicHttpUrl(url)) return null;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml/.test(ct)) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 4_000_000) return null; // don't ingest huge pages
    return { html: Buffer.from(buf).toString("utf8"), finalUrl: res.url || url };
  } catch {
    return null;
  }
}

/** Fetch up to 2 same-origin stylesheets (bounded) so we can read brand colors
 *  and fonts from external CSS (Tailwind/Next sites keep almost nothing inline). */
async function fetchStylesheets(html: string, base: string): Promise<string> {
  const hrefs: string[] = [];
  const origin = (() => {
    try {
      return new URL(base).origin;
    } catch {
      return "";
    }
  })();
  for (const m of html.matchAll(/<link[^>]+>/gi)) {
    if (hrefs.length >= 2) break;
    const tag = m[0];
    if (!/rel=["'][^"']*stylesheet/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const full = abs(href, base);
    if (full.startsWith(origin) && !hrefs.includes(full)) hrefs.push(full);
  }
  let css = "";
  await Promise.all(
    hrefs.map(async (u) => {
      try {
        const res = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 800_000) return;
        css += "\n" + Buffer.from(buf).toString("utf8");
      } catch {
        /* ignore */
      }
    }),
  );
  return css;
}

function formatPhone(raw?: string): string | undefined {
  if (!raw) return undefined;
  const d = raw.replace(/[^\d]/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return raw.trim();
}

// ---- small parsing helpers -------------------------------------------------

const abs = (path: string, base: string): string => {
  try {
    return new URL(path.trim(), base).href;
  } catch {
    return path;
  }
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function metaContent(html: string, key: string): string | undefined {
  // matches property= or name= in either order relative to content=
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeEntities(m[1]).trim();
  }
  return undefined;
}

function stripToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse all JSON-LD blocks and flatten @graph arrays. */
function parseJsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      const items = Array.isArray(data) ? data : [data];
      for (const it of items) {
        if (it && typeof it === "object") {
          const graph = (it as Record<string, unknown>)["@graph"];
          if (Array.isArray(graph)) out.push(...(graph as Record<string, unknown>[]));
          else out.push(it as Record<string, unknown>);
        }
      }
    } catch {
      /* ignore malformed blocks */
    }
  }
  return out;
}

const BUSINESS_TYPES = /LocalBusiness|Organization|Corporation|Store|Restaurant|Contractor|HomeAndConstruction|ProfessionalService|Plumber|Electrician|HVAC|RoofingContractor/i;

function typeMatches(t: unknown): boolean {
  const s = Array.isArray(t) ? t.join(" ") : String(t || "");
  return BUSINESS_TYPES.test(s);
}

function flattenAddress(addr: unknown): string | undefined {
  if (!addr) return undefined;
  if (typeof addr === "string") return addr;
  const a = addr as Record<string, unknown>;
  const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode]
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

function flattenHours(oh: unknown): string | undefined {
  if (!oh) return undefined;
  if (typeof oh === "string") return oh;
  if (Array.isArray(oh)) {
    const parts = oh
      .map((x) => {
        if (typeof x === "string") return x;
        const o = x as Record<string, unknown>;
        const days = Array.isArray(o.dayOfWeek) ? o.dayOfWeek.join(",") : String(o.dayOfWeek || "");
        const day = days.replace(/https?:\/\/schema\.org\//g, "");
        return day && o.opens ? `${day} ${o.opens}–${o.closes}` : "";
      })
      .filter(Boolean);
    return parts.length ? parts.join("; ") : undefined;
  }
  return undefined;
}

// ---- extraction ------------------------------------------------------------

function extractSocials(html: string, base: string): SocialLink[] {
  const map: Record<string, { label: string; re: RegExp }> = {
    facebook: { label: "Facebook", re: /facebook\.com/i },
    instagram: { label: "Instagram", re: /instagram\.com/i },
    linkedin: { label: "LinkedIn", re: /linkedin\.com/i },
    twitter: { label: "X / Twitter", re: /(?:twitter|x)\.com/i },
    youtube: { label: "YouTube", re: /youtube\.com|youtu\.be/i },
    yelp: { label: "Yelp", re: /yelp\.com/i },
    tiktok: { label: "TikTok", re: /tiktok\.com/i },
    pinterest: { label: "Pinterest", re: /pinterest\.com/i },
  };
  const found: Record<string, string> = {};
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
    const href = m[1];
    for (const [key, { re }] of Object.entries(map)) {
      if (!found[key] && re.test(href) && !/sharer|share\?|intent\/|\/plugins\//i.test(href)) {
        found[key] = abs(href, base);
      }
    }
  }
  return Object.entries(found).map(([key, url]) => ({ label: map[key].label, url }));
}

function extractLogo(html: string, base: string, jsonLdLogo?: string): string | undefined {
  if (jsonLdLogo) return abs(jsonLdLogo, base);
  // an <img> whose src/alt/class mentions "logo"
  for (const m of html.matchAll(/<img[^>]+>/gi)) {
    const tag = m[0];
    if (/logo/i.test(tag)) {
      const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] || tag.match(/\bdata-src=["']([^"']+)["']/i)?.[1];
      if (src && !/sprite|icon-|\.ico(\?|$)/i.test(src)) return abs(unwrapNextImage(src), base);
    }
  }
  // apple-touch-icon (usually a clean square mark)
  const touch = html.match(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*href=["']([^"']+)["']/i);
  if (touch) return abs(touch[1], base);
  return undefined;
}

function unwrapNextImage(p: string): string {
  const m = p.match(/\/_next\/image\?url=([^&"']+)/);
  return m ? decodeURIComponent(m[1]) : p;
}

function extractImages(html: string, base: string): string[] {
  const set = new Set<string>();
  const push = (raw?: string) => {
    if (!raw) return;
    let p = unwrapNextImage(raw.trim().replace(/&amp;.*$/, ""));
    if (/\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(p) && !/favicon|sprite|icon-/i.test(p)) set.add(abs(p, base));
  };
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) push(m[1]);
  for (const m of html.matchAll(/<img[^>]+data-src=["']([^"']+)["']/gi)) push(m[1]);
  // background-image: url(...)
  for (const m of html.matchAll(/background-image\s*:\s*url\((['"]?)([^'")]+)\1\)/gi)) push(m[2]);
  return Array.from(set).slice(0, 24);
}

function extractColors(html: string, themeColor: string | undefined, extraCss: string): string[] {
  const counts: Record<string, number> = {};
  const bump = (hex: string) => {
    const h = normalizeHex(hex);
    if (h && !isNeutral(h)) counts[h] = (counts[h] || 0) + 1;
  };
  // scan inline <style> + style attributes + any fetched stylesheets
  const styleZones =
    (html.match(/<style[\s\S]*?<\/style>/gi)?.join(" ") || "") +
    " " +
    (html.match(/style=["'][^"']*["']/gi)?.join(" ") || "") +
    " " +
    extraCss;
  for (const m of styleZones.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) bump("#" + m[1]);
  for (const m of styleZones.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gi)) {
    bump(rgbToHex(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  const ranked = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([h]) => h);
  const themed = themeColor ? [normalizeHex(themeColor)].filter(Boolean) : [];
  return Array.from(new Set([...(themed as string[]), ...ranked])).slice(0, 6);
}

function normalizeHex(hex: string): string {
  let h = hex.trim().toLowerCase();
  if (/^#?[0-9a-f]{3}$/.test(h)) {
    h = h.replace("#", "");
    h = "#" + h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (!h.startsWith("#")) h = "#" + h;
  return /^#[0-9a-f]{6}$/.test(h) ? h : "";
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Drop white/black/near-grey so we surface actual brand colors. */
function isNeutral(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 24 || min > 232) return true; // near-black / near-white
  if (max - min < 18) return true; // grey
  return false;
}

function extractFonts(html: string, extraCss: string): string[] {
  const fonts = new Set<string>();
  for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?([^"']+)/gi)) {
    for (const fam of m[1].matchAll(/family=([^&:]+)/gi)) {
      fonts.add(decodeURIComponent(fam[1].replace(/\+/g, " ")).split(":")[0].trim());
    }
  }
  const styleZones = (html.match(/<style[\s\S]*?<\/style>/gi)?.join(" ") || "") + " " + extraCss;
  for (const m of styleZones.matchAll(/font-family\s*:\s*([^;}"']+)/gi)) {
    const first = m[1].split(",")[0].replace(/['"]/g, "").trim();
    if (
      first &&
      !/fallback/i.test(first) &&
      !/^var\(|^(inherit|initial|sans-serif|serif|monospace|system-ui|ui-sans-serif|-apple-system)$/i.test(first)
    ) {
      fonts.add(first);
    }
  }
  return Array.from(fonts).slice(0, 4);
}

function detectPlatform(html: string): string | undefined {
  const gen = metaContent(html, "generator");
  if (gen) return gen.split(" ")[0];
  if (/static\.wixstatic\.com|wix\.com/i.test(html)) return "Wix";
  if (/squarespace\.com|static1\.squarespace/i.test(html)) return "Squarespace";
  if (/cdn\.shopify\.com/i.test(html)) return "Shopify";
  if (/wp-content|wp-includes/i.test(html)) return "WordPress";
  if (/assets\.website-files\.com|webflow/i.test(html)) return "Webflow";
  if (/godaddy|secureserver\.net/i.test(html)) return "GoDaddy";
  return undefined;
}

function cleanTitle(t?: string): string | undefined {
  if (!t) return undefined;
  // drop a trailing "| Home", "- Official Site" etc but keep the brand
  return t.split(/[|–—\-]/)[0].trim() || t.trim();
}

function firstPhone(html: string, text: string): string | undefined {
  const tel = html.match(/href=["']tel:([^"']+)["']/i);
  if (tel) return tel[1].replace(/[^\d+]/g, "").replace(/^(\+?1)(\d{10})$/, "$1 $2") || tel[1];
  const m = text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  return m ? m[0].trim() : undefined;
}

function firstEmail(html: string, text: string): string | undefined {
  const mailto = html.match(/href=["']mailto:([^"'?]+)/i);
  if (mailto) return mailto[1].trim();
  const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (m && !/\.(png|jpe?g|gif|webp)$/i.test(m[0]) && !/sentry|wixpress|example\./i.test(m[0])) return m[0];
  return undefined;
}

// ---- Gemini synthesis (optional) ------------------------------------------

async function synthesize(
  signals: Partial<SiteAnalysis["business"]> & { text: string; title?: string },
): Promise<Partial<SiteAnalysis["business"]> & { suggestedBrandColor?: string }> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  if (!key) return {};
  const prompt = `You are analyzing a local service business's existing website so we can rebuild it.
From the page text below, return STRICT JSON (no markdown) with keys:
{"niche": "<one short phrase, e.g. 'Residential HVAC & cooling'>",
 "tone": "<3-5 adjectives describing the brand voice>",
 "services": ["<up to 6 concrete services they offer>"],
 "differentiators": ["<up to 4 selling points / trust signals they emphasize>"],
 "suggestedBrandColor": "<a hex like #0E7490 that fits this trade, or empty>"}
Only use what the text supports; omit a field with an empty value if unknown.

BUSINESS NAME: ${signals.name || "(unknown)"}
PAGE TITLE: ${signals.title || ""}
PAGE TEXT (truncated):
${signals.text.slice(0, 7000)}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
        }),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!res.ok) return {};
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return {
      niche: typeof parsed.niche === "string" ? parsed.niche : undefined,
      tone: typeof parsed.tone === "string" ? parsed.tone : undefined,
      services: Array.isArray(parsed.services) ? parsed.services.filter((s: unknown) => typeof s === "string").slice(0, 6) : [],
      differentiators: Array.isArray(parsed.differentiators)
        ? parsed.differentiators.filter((s: unknown) => typeof s === "string").slice(0, 4)
        : [],
      suggestedBrandColor: normalizeHex(String(parsed.suggestedBrandColor || "")) || undefined,
    };
  } catch {
    return {};
  }
}

// ---- main ------------------------------------------------------------------

export async function analyzeSite(inputUrl: string): Promise<SiteAnalysis> {
  let url = inputUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  const base: SiteAnalysis = {
    url,
    finalUrl: url,
    ok: false,
    business: { services: [], differentiators: [] },
    brand: { colors: [], fonts: [] },
    socials: [],
    media: { images: [] },
    meta: { pagesFetched: [] },
  };

  if (!isPublicHttpUrl(url)) return { ...base, error: "That URL isn't a public website address." };

  const home = await fetchPage(url);
  if (!home) return { ...base, error: "Couldn't load that site (blocked, offline, or not HTML)." };
  const finalUrl = home.finalUrl;
  const pages = [{ url: finalUrl, html: home.html }];

  // Pull in an about/contact/services page for richer contact + copy, if linked.
  const wanted = /\/(about|contact|services?|our-work)(\/|$|["'?#])/i;
  const extra = new Set<string>();
  for (const m of home.html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
    if (extra.size >= 2) break;
    const href = m[1];
    if (wanted.test(href) && !/^(mailto:|tel:|#)/i.test(href)) {
      const full = abs(href, finalUrl);
      if (full.startsWith(new URL(finalUrl).origin) && full !== finalUrl) extra.add(full);
    }
  }
  const extraPages = await Promise.all(Array.from(extra).map((u) => fetchPage(u)));
  for (const p of extraPages) if (p) pages.push({ url: p.finalUrl, html: p.html });

  const allHtml = pages.map((p) => p.html).join("\n");
  const text = pages.map((p) => stripToText(p.html)).join("\n").slice(0, 12000);
  const css = await fetchStylesheets(home.html, finalUrl);

  // JSON-LD business record (best structured source)
  const ld = parseJsonLd(allHtml);
  const biz = ld.find((x) => typeMatches(x["@type"])) || {};
  const ldStr = (k: string) => (typeof biz[k] === "string" ? (biz[k] as string).trim() : undefined);
  const ldLogo =
    typeof biz.logo === "string" ? (biz.logo as string) : (biz.logo as Record<string, unknown>)?.url as string | undefined;
  const ldSameAs = Array.isArray(biz.sameAs) ? (biz.sameAs as string[]) : [];

  const themeColor = metaContent(allHtml, "theme-color");
  const name =
    ldStr("name") ||
    metaContent(allHtml, "og:site_name") ||
    metaContent(allHtml, "application-name") ||
    cleanTitle(allHtml.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] && decodeEntities(allHtml.match(/<title[^>]*>([^<]+)<\/title>/i)![1]));
  const ogImage = metaContent(allHtml, "og:image");
  const description = ldStr("description") || metaContent(allHtml, "og:description") || metaContent(allHtml, "description");

  // socials: JSON-LD sameAs merged with scraped anchors
  const socialMap = new Map<string, SocialLink>();
  for (const s of extractSocials(allHtml, finalUrl)) socialMap.set(s.label, s);
  for (const u of ldSameAs) {
    const lbl = /facebook/i.test(u) ? "Facebook" : /instagram/i.test(u) ? "Instagram" : /linkedin/i.test(u) ? "LinkedIn" : /(twitter|x)\.com/i.test(u) ? "X / Twitter" : /youtube/i.test(u) ? "YouTube" : /yelp/i.test(u) ? "Yelp" : "";
    if (lbl && !socialMap.has(lbl)) socialMap.set(lbl, { label: lbl, url: u });
  }

  const images = extractImages(allHtml, finalUrl);
  const logoUrl = extractLogo(allHtml, finalUrl, ldLogo);
  const colors = extractColors(allHtml, themeColor, css);
  const hero = ogImage ? abs(ogImage, finalUrl) : images.find((i) => /hero|banner|header|cover/i.test(i)) || images[0];

  const business: SiteAnalysis["business"] = {
    name: name || undefined,
    description: description || undefined,
    phone: formatPhone(firstPhone(allHtml, text) || ldStr("telephone")),
    email: firstEmail(allHtml, text) || ldStr("email"),
    address: flattenAddress(biz.address),
    hours: flattenHours(biz.openingHoursSpecification || biz.openingHours),
    services: [],
    differentiators: [],
  };

  // semantic synthesis (niche/tone/services) — best-effort
  const synth = await synthesize({ name: business.name, title: cleanTitle(name), text });
  business.niche = synth.niche;
  business.tone = synth.tone;
  business.services = synth.services || [];
  business.differentiators = synth.differentiators || [];

  return {
    url,
    finalUrl,
    ok: true,
    business,
    brand: {
      logoUrl,
      colors,
      fonts: extractFonts(allHtml, css),
      themeColor: themeColor ? normalizeHex(themeColor) || themeColor : undefined,
      suggestedBrandColor: synth.suggestedBrandColor || colors[0],
    },
    socials: Array.from(socialMap.values()),
    media: { hero, images },
    meta: {
      title: cleanTitle(name),
      ogImage: ogImage ? abs(ogImage, finalUrl) : undefined,
      platform: detectPlatform(allHtml),
      pagesFetched: pages.map((p) => p.url),
    },
  };
}

/** Map an analysis to the forge's business.json shape (for a future "send to forge"). */
export function analysisToBusinessJson(a: SiteAnalysis): Record<string, unknown> {
  return {
    name: a.business.name,
    niche: a.business.niche,
    phone: a.business.phone,
    email: a.business.email,
    service_area: a.business.address,
    brand_color: a.brand.suggestedBrandColor || a.brand.colors[0],
    tone: a.business.tone,
    services: a.business.services,
    differentiators: a.business.differentiators,
    logoUrl: a.brand.logoUrl,
    existing_website_url: a.finalUrl,
    notes: a.business.description,
  };
}
