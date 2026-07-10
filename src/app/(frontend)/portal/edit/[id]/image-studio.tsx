"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ASSET_SPECS, normalizeAsset, type AssetSpec, type NormalizeMode } from "@/lib/logo-spec";

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
  const [assetType, setAssetType] = useState<AssetSpec>(ASSET_SPECS[0]);
  const [assets, setAssets] = useState<{ label: string; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  // A generation the trim couldn't rescue (bare icon instead of a circle, square instead of a
  // lockup). Shown as a persistent banner — it needs a re-generate, not a nudge.
  const [warn, setWarn] = useState<string | null>(null);
  // "Save to my site" is async — it files an edit the forge applies + redeploys in a few minutes.
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [genPrompt, setGenPrompt] = useState("");
  const [useRef_, setUseRef] = useState(true);
  const [editPrompt, setEditPrompt] = useState("");
  const [rot, setRot] = useState(0);
  const [adj, setAdj] = useState({ brightness: 100, contrast: 100, saturate: 100 });
  // Mobile: show one control group at a time (segmented sub-nav) so the canvas stays visible.
  const [mtab, setMtab] = useState<"create" | "type" | "enhance" | "adjust">("create");
  // Collapse the controls so the canvas gets the full width (handy in landscape on a phone).
  const [collapsed, setCollapsed] = useState(false);
  const grp = (k: typeof mtab) => (mtab === k ? "space-y-4" : "hidden space-y-4 md:block");

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
  // A "saved" confirmation is about the exact canvas that was pushed. Drop it the moment ANYTHING
  // that changes the canvas changes — new image, target type, OR a rotate/brightness/contrast/
  // saturation tweak (rot/adj feed draw(), which currentDataUrl() reads) — so it can't claim an
  // un-saved edit went live.
  useEffect(() => { setSaved(null); }, [src, assetType, rot, adj]);

  const currentDataUrl = () => canvasRef.current?.toDataURL("image/png") || null;

  async function post(prompt: string, ref?: string | null, aspect?: string, normalize?: NormalizeMode) {
    setBusy(true); setStatus(ref ? "Working on it…" : "Generating…"); setWarn(null);
    try {
      const res = await fetch("/api/generate-image", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, refDataUrl: ref || undefined, aspect }),
      }).then((r) => r.json());
      if (res.ok && res.dataUrl) {
        // Logos come back centered in a big transparent canvas. Trim it back to the true mark and
        // re-pad per type — the same geometry the forge bakes at build time (see src/lib/logo-spec.ts),
        // so a Studio logo drops into a navbar at full size instead of a sliver.
        const fixed = normalize ? await normalizeAsset(res.dataUrl, normalize) : null;
        setSrc(fixed?.dataUrl ?? res.dataUrl);
        setWarn(fixed?.warn ?? null);
        setStatus("");
      } else setStatus(res.error || "Didn't work — try again.");
    } catch { setStatus("Request failed."); }
    setBusy(false);
  }
  // New generations honor the asset's aspect (wide lockup / circle / 16:9). AI edits omit the aspect
  // so they preserve the current image's shape — but they still get the per-type trim, because the
  // edits that matter most for a logo ("Remove bg") are exactly the ones that re-introduce a big
  // transparent margin. Trim+pad is idempotent, so it's a no-op on edits that don't.
  const generate = () => genPrompt.trim().length >= 3 && post(`${genPrompt.trim()} — ${assetType.hint}`, useRef_ && src ? currentDataUrl() : undefined, assetType.aspect, assetType.normalize);
  const aiEdit = (instruction: string) => {
    const ref = currentDataUrl();
    if (!ref) { setStatus("Load or generate an image first."); return; }
    if (instruction.trim().length >= 3) post(instruction.trim(), ref, undefined, assetType.normalize);
  };

  function loadFromUrl(url: string) {
    setStatus("Loading asset…"); setBusy(true); setWarn(null);
    // Route through our proxy-free fetch → dataURL so it's editable + exportable.
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext("2d")?.drawImage(img, 0, 0); try { setSrc(c.toDataURL("image/png")); setStatus(""); } catch { setStatus("That asset blocked editing."); } setBusy(false); };
    img.onerror = () => { setStatus("Couldn't load that asset."); setBusy(false); };
    img.src = url;
  }
  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setWarn(null);
    const fr = new FileReader(); fr.onload = () => setSrc(String(fr.result)); fr.readAsDataURL(f);
  }
  function download() {
    const url = currentDataUrl(); if (!url) return;
    const a = document.createElement("a"); a.href = url; a.download = `${assetType.key}.png`; a.click();
  }
  // Push the current canvas to the live site as this asset type. Files an edit the forge applies
  // deterministically (logo/circle overwrite their canonical file + re-normalize; other types are
  // placed by the build agent), then rebuilds + redeploys — so it lands in a few minutes, not now.
  async function saveToSite() {
    const dataUrl = currentDataUrl();
    if (!dataUrl) { setStatus("Load or generate an image first."); return; }
    setSaving(true); setSaved(null); setStatus("");
    try {
      const res = await fetch("/api/edit-requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          edits: [{ kind: "asset", tag: "asset", text: assetType.label, changes: { asset: { key: assetType.key, dataUrl, mime: "image/png" } } }],
        }),
      }).then((r) => r.json());
      if (res.ok) setSaved(`✓ Saved — your ${assetType.label.toLowerCase()} goes live in a few minutes.`);
      else setStatus(res.error || "Couldn't save — try again.");
    } catch { setStatus("Save failed — try again."); }
    setSaving(false);
  }

  const MOBILE_TABS: { key: typeof mtab; label: string }[] = [
    { key: "create", label: "Create" },
    { key: "type", label: "Type" },
    { key: "enhance", label: "Enhance" },
    { key: "adjust", label: "Adjust" },
  ];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
      {/* Rotate-to-landscape gate — the Studio needs width; on a phone held portrait, cover it with
          a prompt to turn sideways (web can't force rotation). Shows ONLY on a small portrait screen;
          hidden in landscape and on tablet/desktop (md:!hidden). Covers just the Studio, so the tab
          bar underneath stays reachable. */}
      <div className="absolute inset-0 z-40 hidden flex-col items-center justify-center gap-3 bg-surface px-8 text-center portrait:flex md:!hidden">
        <div className="text-4xl">📱↺</div>
        <p className="text-base font-semibold text-ink">Rotate your phone to landscape</p>
        <p className="max-w-xs text-sm text-ink-soft">The brand-asset studio works best on a wider screen. Turn your device sideways to keep editing.</p>
      </div>

      {/* Canvas — a fixed strip on top on phones (always visible while you work), big panel on the
          right on desktop (order-last on md keeps the controls on the left, as before). */}
      <div className="relative order-first flex h-[38vh] shrink-0 items-center justify-center overflow-auto bg-[repeating-conic-gradient(#e9edf3_0%_25%,#f6f8fb_0%_50%)] bg-[length:24px_24px] p-4 md:order-last md:h-auto md:min-h-0 md:flex-1 md:p-6">
        {/* Collapse toggle (side-by-side layouts only) — reclaim the controls' width for the canvas. */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="absolute right-3 top-3 z-10 hidden items-center gap-1 rounded-full border border-line bg-surface/90 px-3 py-1.5 text-xs font-semibold text-ink-soft shadow-sm backdrop-blur hover:text-ink md:inline-flex"
          title={collapsed ? "Show controls" : "Hide controls"}
        >
          {collapsed ? "⟨ Controls" : "Hide ⟩"}
        </button>
        {src ? (
          <canvas ref={canvasRef} className="max-h-full max-w-full rounded-lg shadow-lg" />
        ) : (
          <div className="max-w-sm text-center text-ink-soft">
            <p className="text-base font-semibold md:text-lg">🎨 Brand-asset studio</p>
            <p className="mt-1 text-xs md:text-sm">Pick an asset type, then generate one from a prompt, load your site&apos;s current asset, or upload an image to edit.</p>
          </div>
        )}
        {status && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white shadow-lg">
            {busy && <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white align-middle" />}{status}
          </div>
        )}
      </div>

      <aside className={`flex min-h-0 flex-1 flex-col border-t border-line bg-surface text-sm md:w-72 md:flex-none md:border-r md:border-t-0 ${collapsed ? "md:hidden" : ""}`}>
        {/* Mobile-only segmented sub-nav — one control group at a time */}
        <div className="flex gap-1 border-b border-line p-2 md:hidden">
          {MOBILE_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setMtab(t.key)}
              className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors ${mtab === t.key ? "bg-ink text-white" : "text-ink-soft"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div className={grp("type")}>
            <Section title="Asset type">
              <div className="flex flex-wrap gap-1.5">
                {ASSET_SPECS.map((t) => (
                  // The warning describes the LAST generation's shape — it's meaningless once the
                  // target type changes, so drop it rather than misattribute it to the new type.
                  <button key={t.key} onClick={() => { setAssetType(t); setWarn(null); }} className={`rounded-full border px-3 py-1.5 text-xs font-medium md:px-2.5 md:py-1 ${assetType.key === t.key ? "border-brand bg-brand text-white" : "border-line bg-background hover:bg-brand-tint"}`}>{t.label}</button>
                ))}
              </div>
            </Section>
          </div>

          <div className={grp("create")}>
            <Section title="Generate">
              <p className="mb-1.5 text-[11px] text-ink-soft">
                Shape: <span className="font-medium text-ink">{assetType.shape}</span>
                {assetType.note && ` — ${assetType.note}`}
              </p>
              <textarea value={genPrompt} onChange={(e) => setGenPrompt(e.target.value)} placeholder={`Describe a ${assetType.label.toLowerCase()}…`} className="w-full rounded-xl border border-line bg-background px-3 py-2 text-sm" rows={2} />
              {src && (
                <label className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-soft"><input type="checkbox" checked={useRef_} onChange={(e) => setUseRef(e.target.checked)} /> build from the current image</label>
              )}
              <button onClick={generate} disabled={busy} className="mt-2 w-full rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">Generate</button>
              {warn && (
                <p role="status" className="mt-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-900">
                  ⚠️ {warn}
                </p>
              )}
            </Section>

            <Section title="Start from">
              <label className="block cursor-pointer rounded-full border border-line bg-background px-4 py-2.5 text-center text-xs font-semibold hover:bg-surface">Upload an image<input type="file" accept="image/*" onChange={onUpload} className="hidden" /></label>
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
          </div>

          <div className={grp("enhance")}>
            <Section title="AI enhance">
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (<button key={p.label} onClick={() => aiEdit(p.prompt)} disabled={busy} className="rounded-full border border-line bg-background px-3 py-1.5 text-xs font-medium hover:bg-brand-tint disabled:opacity-50 md:px-2.5 md:py-1">{p.label}</button>))}
              </div>
              <textarea value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} placeholder="Or describe an edit…" className="mt-2 w-full rounded-xl border border-line bg-background px-3 py-2 text-sm" rows={2} />
              <button onClick={() => aiEdit(editPrompt)} disabled={busy} className="mt-2 w-full rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink/90 disabled:opacity-50">AI edit</button>
            </Section>
          </div>

          <div className={grp("adjust")}>
            <Section title="Adjust">
              <Slider label="Brightness" value={adj.brightness} onChange={(v) => setAdj((a) => ({ ...a, brightness: v }))} />
              <Slider label="Contrast" value={adj.contrast} onChange={(v) => setAdj((a) => ({ ...a, contrast: v }))} />
              <Slider label="Saturation" value={adj.saturate} onChange={(v) => setAdj((a) => ({ ...a, saturate: v }))} />
              <div className="mt-2 flex gap-2">
                <button onClick={() => setRot((r) => (r + 90) % 360)} className="flex-1 rounded-full border border-line bg-background px-3 py-2 text-xs font-semibold hover:bg-surface">↻ Rotate</button>
                <button onClick={() => { setRot(0); setAdj({ brightness: 100, contrast: 100, saturate: 100 }); }} className="flex-1 rounded-full border border-line bg-background px-3 py-2 text-xs font-semibold hover:bg-surface">Reset</button>
              </div>
            </Section>
          </div>

          {/* Desktop: Save (primary) + Download (secondary) flow at the end of the controls. */}
          <div className="hidden md:block">
            <button onClick={saveToSite} disabled={!src || saving} className="w-full rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40">
              {saving ? "Saving…" : "Save to my site"}
            </button>
            <button onClick={download} disabled={!src} className="mt-2 w-full rounded-full border border-line bg-background px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-40">⬇ Download</button>
            {saved && <p role="status" className="mt-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-[11px] leading-snug text-emerald-800">{saved}</p>}
          </div>
        </div>

        {/* Mobile: pinned action bar so Save + Download are always reachable without scrolling. */}
        <div className="space-y-2 border-t border-line bg-surface p-3 md:hidden">
          {saved && <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-[11px] leading-snug text-emerald-800">{saved}</p>}
          <button onClick={saveToSite} disabled={!src || saving} className="w-full rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40">
            {saving ? "Saving…" : "Save to my site"}
          </button>
          <button onClick={download} disabled={!src} className="w-full rounded-full border border-line bg-background px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-40">⬇ Download</button>
        </div>
      </aside>
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
