"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Meta Pixel (docs/ADS.md §6) — env-gated: renders nothing unless NEXT_PUBLIC_META_PIXEL_ID is
 * set, so preview/dev deploys without the var send nothing. Two jobs:
 *  1. PageView on load + every client-side route change — builds the website custom audience
 *     that ads retarget (outreach traffic banks into the pool from day one).
 *  2. `Lead` once per session when the contact form's success redirect (`?sent=1`, see
 *     /api/contact) lands — the conversion the Leads campaign objective optimizes on.
 */
const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean };
    _fbq?: unknown;
  }
}

function ensurePixel(): NonNullable<Window["fbq"]> | null {
  if (!PIXEL_ID) return null;
  if (window.fbq) return window.fbq;
  const fbq: NonNullable<Window["fbq"]> = (...args: unknown[]) => {
    (fbq.queue as unknown[]).push(args);
  };
  fbq.queue = [];
  fbq.loaded = true;
  window.fbq = fbq;
  window._fbq = fbq;
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(s);
  fbq("init", PIXEL_ID);
  return fbq;
}

function MetaPixelInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const booted = useRef(false);

  // PageView on mount and on every route change (the base snippet only covers the first load).
  useEffect(() => {
    const fbq = ensurePixel();
    if (!fbq) return;
    if (!booted.current) booted.current = true;
    fbq("track", "PageView");
  }, [pathname]);

  // Contact-form success → Lead, once per browser session (survives the redirect, not refreshes).
  useEffect(() => {
    if (searchParams.get("sent") !== "1") return;
    const fbq = ensurePixel();
    if (!fbq) return;
    try {
      if (sessionStorage.getItem("tbj_pixel_lead")) return;
      sessionStorage.setItem("tbj_pixel_lead", "1");
    } catch {
      // private mode: still track, at worst a refresh double-counts one Lead
    }
    fbq("track", "Lead");
  }, [searchParams]);

  return null;
}

export function MetaPixel() {
  if (!PIXEL_ID) return null;
  return (
    // useSearchParams needs a Suspense boundary in the app router; the component renders nothing.
    <Suspense fallback={null}>
      <MetaPixelInner />
    </Suspense>
  );
}
