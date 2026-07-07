#!/usr/bin/env node
// gen-preview-stock.mjs — one-time: generate the shared niche-stock hero images the
// showroom previews reuse (public/preview-stock/<niche>.jpg). Run once; every preview
// then uses them for free. Regenerate a single one with: node scripts/gen-preview-stock.mjs <name>
import fs from "node:fs";
import path from "node:path";

function loadEnv(f) {
  const o = {};
  try {
    for (const l of fs.readFileSync(f, "utf8").split("\n")) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) o[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {}
  return o;
}
const env = loadEnv(path.join(process.env.HOME, "code/thinkbigjoe/.env.local"));
const KEY = env.GEMINI_API_KEY || env.GOOGLE_GENAI_API_KEY;
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent";
const OUT = path.join(process.env.HOME, "code/thinkbigjoe/public/preview-stock");
fs.mkdirSync(OUT, { recursive: true });

const SET = {
  plumbing: "a professional plumber fixing chrome pipes under a modern kitchen sink",
  hvac: "an HVAC technician servicing an outdoor air-conditioning condenser unit beside a house",
  electrical: "an electrician working on a residential electrical breaker panel",
  roofing: "a freshly installed residential asphalt-shingle roof under a clear blue sky",
  landscaping: "a beautifully maintained green residential front yard with clean landscaping",
  cleaning: "a spotless bright modern living room after a professional cleaning",
  pest: "a pest-control technician in uniform treating the exterior foundation of a home",
  pool: "a clean sparkling blue backyard swimming pool on a sunny day",
  auto: "a clean car being professionally detailed in a bright auto shop",
  modern: "modern solar panels installed on the roof of a contemporary home",
  contractor: "a contractor renovating a bright home interior, tools and fresh materials",
  general: "a clean white service-company work van parked in front of a suburban home",
};

async function gen(name, desc) {
  const prompt = `A professional, bright, realistic wide-angle photograph of ${desc}. Clean and modern, natural daylight, high quality. No text, no watermark, no logo, no visible human faces. Suitable as a website hero background.`;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"] } }),
    });
    if (!res.ok) { console.log(`✗ ${name}: HTTP ${res.status}`); return; }
    const json = await res.json();
    const parts = json?.candidates?.[0]?.content?.parts || [];
    const img = parts.find((p) => p.inlineData || p.inline_data);
    if (!img) { console.log(`✗ ${name}: no image in response`); return; }
    const d = img.inlineData || img.inline_data;
    const buf = Buffer.from(d.data, "base64");
    fs.writeFileSync(path.join(OUT, `${name}.jpg`), buf);
    console.log(`✓ ${name} (${Math.round(buf.length / 1024)}KB, ${d.mimeType || d.mime_type})`);
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`);
  }
}

const only = process.argv[2];
const entries = only ? [[only, SET[only]]].filter(([, v]) => v) : Object.entries(SET);
for (const [k, v] of entries) await gen(k, v);
console.log("done");
