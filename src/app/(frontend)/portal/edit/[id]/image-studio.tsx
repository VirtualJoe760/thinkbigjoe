"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type AssetType = { key: string; label: string; hint: string; round?: boolean; aspect?: string; shape?: string };
const ASSET_TYPES: AssetType[] = [
  // Logo defaults to a WIDE horizontal lockup (21:9) — a square/centered logo renders tiny in a
  // navbar (same issue the forge fixes). Circular is the 1:1 emblem for favicons/avatars.
  { key: "logo", label: "Logo", hint: "as a HORIZONTAL brand logo lockup — the icon on the LEFT and the business-name wordmark on the RIGHT, side by side, flat and crisp, on a transparent background, tightly framed with minimal margin (NOT a small mark centered in empty space)", aspect: "21:9", shape: "wide lockup" },
  { key: "circle", label: "Circular logo", hint: "as a circular logo/badge — the icon or monogram centered inside a circle, on a transparent background", round: true, aspect: "1:1", shape: "1:1 circle" },
  { key: "og", label: "OG image", hint: "as a wide social-share banner (Open Graph) with the brand feel, balanced, with room for text", aspect: "16:9", shape: "16:9 banner" },
  { key: "hero", label: "Hero image", hint: "as a wide hero background photo, leaving clear space on the left for headline text", aspect: "16:9", shape: "16:9 wide" },
  { key: "carousel", label: "Carousel image", hint: "as a clean gallery/carousel image", aspect: "4:3", shape: "4:3" },
];

const PRESETS = [
  { label: "✨ Enhance", prompt: "Enhance this image: improve lighting, sharpness, color and detail, keep the exact composition and subject." },
  { label: "Remove bg", prompt: "Remove the background completely; keep only the main subject on a transparent background." },
  { label: "Brighten", prompt: "Brighten and add natural warmth." },
  { label: "Sharpen", prompt: "Increase clarity and sharpness, reduce blur and noise; keep the composition." },
];

export function ImageStudio({ siteId }: { siteId: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [assetType, setAssetType] = useState<AssetType>(ASSET_TYPES[0]);
  const [assets, setAssets] = useState<{ label: string; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [genPrompt, setGenPrompt] = useState("");
  const [useRef_, setUseRef] = useState(true);
  const [editPrompt, setEditPrompt] = useState("");
  const [rot, setRot] = useState(0);
  const [adj, setAdj] = useState({ brightness: 100, contrast: 100, saturate: 100 });

  useEffect(() => {
    fetch(`/api/site-assets/${siteId}`).then((r) => r.json()).then((d) => setAssets(d.assets || [])).catch(() => {});
  }, [siteId]);

  const round = assetType.round;
  const draw = useCallback(() => {
    const cv = canvasRef.current, img = imgRef.current;
    if (!cv || !img) return;
    const swap = rot % 180 !== 0;
    cv.width = swap ? img.naturalHeight : img.naturalWidth;
    cv.height = swap ? img.naturalWidth : img.naturalHeight;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.save();
    if (round) { ctx.beginPath(); ctx.arc(cv.width / 2, cv.height / 2, Math.min(cv.width, cv.height) / 2, 0, Math.PI * 2); ctx.clip(); }
    ctx.filter = `brightness(${adj.brightness}%) contrast(${adj.contrast}%) saturate(${adj.saturate}%)`;
    ctx.translate(cv.width / 2, cv.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();
  }, [rot, adj, round]);

  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { imgRef.current = img; setRot(0); setAdj({ brightness: 100, contrast: 100, saturate: 100 }); draw(); };
    img.onerror = () => setStatus("Couldn't load that image.");
    img.src = src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
  useEffect(() => { draw(); }, [rot, adj, round, draw]);

  const currentDataUrl = () => canvasRef.current?.toDataURL("image/png") || null;

  async function post(prompt: string, ref?: string | null, aspect?: string) {
    setBusy(true); setStatus(ref ? "Working on it…" : "Generating…");
    try {
      const res = await fetch("/api/generate-image", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, refDataUrl: ref || undefined, aspect }),
      }).then((r) => r.json());
      if (res.ok && res.dataUrl) { setSrc(res.dataUrl); setStatus(""); } else setStatus(res.error || "Didn't work — try again.");
    } catch { setStatus("Request failed."); }
    setBusy(false);
  }
  // New generations honor the asset's aspect (wide lockup / circle / 16:9). AI edits omit it so
  // they preserve the current image's shape.
  const generate = () => genPrompt.trim().length >= 3 && post(`${genPrompt.trim()} — ${assetType.hint}`, useRef_ && src ? currentDataUrl() : undefined, assetType.aspect);
  const aiEdit = (instruction: string) => {
    const ref = currentDataUrl();
    if (!ref) { setStatus("Load or generate an image first."); return; }
    if (instruction.trim().length >= 3) post(instruction.trim(), ref);
  };

  function loadFromUrl(url: string) {
    setStatus("Loading asset…"); setBusy(true);
    // Route through our proxy-free fetch → dataURL so it's editable + exportable.
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext("2d")?.drawImage(img, 0, 0); try { setSrc(c.toDataURL("image/png")); setStatus(""); } catch { setStatus("That asset blocked editing."); } setBusy(false); };
    img.onerror = () => { setStatus("Couldn't load that asset."); setBusy(false); };
    img.src = url;
  }
  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const fr = new FileReader(); fr.onload = () => setSrc(String(fr.result)); fr.readAsDataURL(f);
  }
  function download() {
    const url = currentDataUrl(); if (!url) return;
    const a = document.createElement("a"); a.href = url; a.download = `${assetType.key}.png`; a.click();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className="w-full shrink-0 space-y-4 overflow-y-auto border-b border-line bg-surface p-4 text-sm md:w-72 md:border-b-0 md:border-r">
        <Section title="Asset type">
          <div className="flex flex-wrap gap-1.5">
            {ASSET_TYPES.map((t) => (
              <button key={t.key} onClick={() => setAssetType(t)} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${assetType.key === t.key ? "border-brand bg-brand text-white" : "border-line bg-background hover:bg-brand-tint"}`}>{t.label}</button>
            ))}
          </div>
        </Section>

        <Section title="Generate">
          {assetType.shape && (
            <p className="mb-1.5 text-[11px] text-ink-soft">
              Shape: <span className="font-medium text-ink">{assetType.shape}</span>
              {assetType.key === "logo" && " — fills a navbar without shrinking"}
            </p>
          )}
          <textarea value={genPrompt} onChange={(e) => setGenPrompt(e.target.value)} placeholder={`Describe a ${assetType.label.toLowerCase()}…`} className="w-full rounded-xl border border-line bg-background px-3 py-2 text-sm" rows={2} />
          {src && (
            <label className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-soft"><input type="checkbox" checked={useRef_} onChange={(e) => setUseRef(e.target.checked)} /> build from the current image</label>
          )}
          <button onClick={generate} disabled={busy} className="mt-2 w-full rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">Generate</button>
        </Section>

        <Section title="Start from">
          <label className="block cursor-pointer rounded-full border border-line bg-background px-4 py-2 text-center text-xs font-semibold hover:bg-surface">Upload an image<input type="file" accept="image/*" onChange={onUpload} className="hidden" /></label>
          {assets.length > 0 && (
            <>
              <p className="mt-2 text-xs text-ink-soft">Your site&apos;s assets:</p>
              <div className="mt-1 grid grid-cols-3 gap-1.5">
                {assets.map((a, i) => (
                  <button key={i} onClick={() => loadFromUrl(a.url)} title={a.label} className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-background hover:border-brand">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.url} alt={a.label} className="h-full w-full object-contain p-1" />
                    <span className="absolute inset-x-0 bottom-0 bg-ink/70 py-0.5 text-center text-[9px] text-white opacity-0 group-hover:opacity-100">{a.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </Section>

        <Section title="AI enhance">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (<button key={p.label} onClick={() => aiEdit(p.prompt)} disabled={busy} className="rounded-full border border-line bg-background px-2.5 py-1 text-xs font-medium hover:bg-brand-tint disabled:opacity-50">{p.label}</button>))}
          </div>
          <textarea value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} placeholder="Or describe an edit…" className="mt-2 w-full rounded-xl border border-line bg-background px-3 py-2 text-sm" rows={2} />
          <button onClick={() => aiEdit(editPrompt)} disabled={busy} className="mt-2 w-full rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/90 disabled:opacity-50">AI edit</button>
        </Section>

        <Section title="Adjust">
          <Slider label="Brightness" value={adj.brightness} onChange={(v) => setAdj((a) => ({ ...a, brightness: v }))} />
          <Slider label="Contrast" value={adj.contrast} onChange={(v) => setAdj((a) => ({ ...a, contrast: v }))} />
          <Slider label="Saturation" value={adj.saturate} onChange={(v) => setAdj((a) => ({ ...a, saturate: v }))} />
          <div className="mt-2 flex gap-2">
            <button onClick={() => setRot((r) => (r + 90) % 360)} className="flex-1 rounded-full border border-line bg-background px-3 py-1.5 text-xs font-semibold hover:bg-surface">↻ Rotate</button>
            <button onClick={() => { setRot(0); setAdj({ brightness: 100, contrast: 100, saturate: 100 }); }} className="flex-1 rounded-full border border-line bg-background px-3 py-1.5 text-xs font-semibold hover:bg-surface">Reset</button>
          </div>
        </Section>

        <button onClick={download} disabled={!src} className="w-full rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40">⬇ Download {assetType.label}</button>
      </aside>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(#e9edf3_0%_25%,#f6f8fb_0%_50%)] bg-[length:24px_24px] p-6">
        {src ? (
          <canvas ref={canvasRef} className="max-h-full max-w-full rounded-lg shadow-lg" />
        ) : (
          <div className="max-w-sm text-center text-ink-soft">
            <p className="text-lg font-semibold">🎨 Brand-asset studio</p>
            <p className="mt-1 text-sm">Pick an asset type, then generate one from a prompt, load your site&apos;s current asset, or upload an image to edit.</p>
          </div>
        )}
        {status && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white shadow-lg">
            {busy && <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white align-middle" />}{status}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (<div><h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft">{title}</h3><div className="mt-1.5">{children}</div></div>);
}
function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="mt-1.5 block text-xs font-medium text-ink-soft">
      <span className="flex justify-between"><span>{label}</span><span>{value}%</span></span>
      <input type="range" min={0} max={200} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-brand" />
    </label>
  );
}
