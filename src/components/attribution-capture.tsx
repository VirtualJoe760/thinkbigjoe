"use client";

import { useEffect, useState } from "react";

/**
 * Paid-traffic attribution capture (docs/ADS.md).
 *
 * Ads land with ?utm_*&fbclid= on the URL, but the form-fill happens pages (sometimes days)
 * later — so the landing click is stashed in localStorage and the intake form submits it with
 * the lead. Last paid touch wins: a newer ad click overwrites an older one, matching how Meta
 * itself attributes the conversion. Organic visits never write anything.
 */

const KEY = "tbj_attr";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // Meta's max click-attribution window is 28 days

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

export type Attribution = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  fbclid?: string;
  referrer?: string;
  landing_path?: string;
  at?: number;
};

/** Stored attribution if present and within the 28-day window, else null. */
export function readAttribution(): Attribution | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const attr = JSON.parse(raw) as Attribution;
    if (!attr.at || Date.now() - attr.at > MAX_AGE_MS) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return attr;
  } catch {
    return null;
  }
}

export function AttributionCapture() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const fbclid = params.get("fbclid");
      const hasUtm = UTM_KEYS.some((k) => params.get(k));
      if (!hasUtm && !fbclid) return;

      const attr: Attribution = { at: Date.now() };
      for (const k of UTM_KEYS) {
        const v = params.get(k)?.trim();
        if (v) attr[k] = v.slice(0, 200);
      }
      if (fbclid) attr.fbclid = fbclid.slice(0, 500);
      if (document.referrer) attr.referrer = document.referrer.slice(0, 500);
      attr.landing_path = window.location.pathname.slice(0, 200);

      window.localStorage.setItem(KEY, JSON.stringify(attr));
    } catch {
      // localStorage unavailable (private mode) — the lead just lands unattributed
    }
  }, []);

  return null;
}

/**
 * Hidden <input>s carrying the stored attribution, for plain form-POST forms (the contact form)
 * that can't attach a JSON body. Renders nothing until mounted (attribution lives in
 * localStorage) and nothing at all for unattributed visitors.
 */
export function AttributionFields() {
  const [attr, setAttr] = useState<Attribution | null>(null);
  useEffect(() => setAttr(readAttribution()), []);
  if (!attr) return null;
  return (
    <>
      {UTM_KEYS.map((k) =>
        attr[k] ? <input key={k} type="hidden" name={k} value={attr[k]} /> : null,
      )}
      {attr.fbclid ? <input type="hidden" name="fbclid" value={attr.fbclid} /> : null}
      {attr.referrer ? <input type="hidden" name="attr_referrer" value={attr.referrer} /> : null}
      {attr.landing_path ? (
        <input type="hidden" name="attr_landing_path" value={attr.landing_path} />
      ) : null}
    </>
  );
}
