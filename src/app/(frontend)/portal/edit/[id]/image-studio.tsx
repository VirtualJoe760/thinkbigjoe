"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const PRESETS = [
  { label: "✨ Enhance", prompt: "Enhance this image: improve lighting, sharpness, color and detail while keeping the exact same composition and subject." },
  { label: "Remove background", prompt: "Remove the background completely, keep only the main subject on a transparent background." },
  { label: "Brighten", prompt: "Brighten and add warmth to this image, keep it natural." },
  { label: "Studio look", prompt: "Give this a clean professional product/studio look with soft even lighting and a subtle backdrop." },
  { label: "Sharpen", prompt: "Increase clarity and sharpness, reduce blur and noise, keep the composition." },
];

export function ImageStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [genPrompt, setGenPrompt] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [rot, setRot] = useState(0);
  const [adj, setAdj] = useState({ brightness: 100, contrast: 100, saturate: 100 });

  // (re)draw the canvas with current rotation + filters
  const draw = useCallback(() => {
    const cv = canvasRef.current, img = imgRef.current;
    if (!cv || !img) return;
    const swap = rot % 180 !== 0;
    cv.width = swap ? img.naturalHeight : img.naturalWidth;
    cv.height = swap ? img.naturalWidth : img.naturalHeight;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.filter = `brightness(${adj.brightness}%) contrast(${adj.contrast}%) saturate(${adj.saturate}%)`;
    ctx.save();
    ctx.translate(cv.width / 2, cv.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();
  }, [rot, adj]);

  // load a new source image, then draw
  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => { imgRef.current = img; setRot(0); setAdj({ brightness: 100, contrast: 100, saturate: 100 }); draw(); };
    img.src = src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
  useEffect(() => { draw(); }, [rot, adj, draw]);

  const currentDataUrl = () => canvasRef.current?.toDataURL("image/png") || null;

  async function generate() {
    if (genPrompt.trim().length < 3) return;
    setBusy(true); setStatus("Generating…");
    try {
      const res = await fetch("/api/generate-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: genPrompt }) }).then((r) => r.json());
      if (res.ok && res.dataUrl) { setSrc(res.dataUrl); setStatus(""); } else setStatus(res.error || "Couldn't generate.");
    } catch { setStatus("Generation failed."); }
    setBusy(false);
  }

  async function aiEdit(instruction: string) {
    const ref = currentDataUrl();
    if (!ref) { setStatus("Add an image first (generate or upload)."); return; }
    if (instruction.trim().length < 3) return;
    setBusy(true); setStatus("Working on it…");
    try {
      const res = await fetch("/api/generate-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: instruction, refDataUrl: ref }) }).then((r) => r.json());
      if (res.ok && res.dataUrl) { setSrc(res.dataUrl); setStatus(""); } else setStatus(res.error || "Couldn't edit.");
    } catch { setStatus("Edit failed."); }
    setBusy(false);
  }

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const fr = new FileReader(); fr.onload = () => setSrc(String(fr.result)); fr.readAsDataURL(f);
  }
  function download() {
    const url = currentDataUrl(); if (!url) return;
    const a = document.createElement("a"); a.href = url; a.download = "thinkbigjoe-image.png"; a.click();
  }

  const disabled = busy;
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      {/* controls */}
      <aside className="w-full shrink-0 space-y-5 overflow-y-auto border-b border-line bg-surface p-5 md:w-80 md:border-b-0 md:border-r">
        <Section title="Generate">
          <textarea value={genPrompt} onChange={(e) => setGenPrompt(e.target.value)} placeholder="Describe an image to create…" className="w-full rounded-xl border border-line bg-background px-3 py-2 text-sm" rows={2} />
          <button onClick={generate} disabled={disabled} className="mt-2 w-full rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">Generate</button>
          <label className="mt-2 block cursor-pointer rounded-full border border-line bg-background px-4 py-2 text-center text-sm font-semibold hover:bg-surface">
            Upload an image<input type="file" accept="image/*" onChange={onUpload} className="hidden" />
          </label>
        </Section>

        <Section title="AI enhance">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p.label} onClick={() => aiEdit(p.prompt)} disabled={disabled} className="rounded-full border border-line bg-background px-3 py-1.5 text-xs font-medium hover:bg-brand-tint disabled:opacity-50">{p.label}</button>
            ))}
          </div>
          <textarea value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} placeholder="Or describe an edit… e.g. add a sunset sky" className="mt-2 w-full rounded-xl border border-line bg-background px-3 py-2 text-sm" rows={2} />
          <button onClick={() => aiEdit(editPrompt)} disabled={disabled} className="mt-2 w-full rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/90 disabled:opacity-50">AI edit</button>
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

        <button onClick={download} disabled={!src} className="w-full rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40">⬇ Download</button>
      </aside>

      {/* canvas */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(#e9edf3_0%_25%,#f6f8fb_0%_50%)] bg-[length:24px_24px] p-6">
        {src ? (
          <canvas ref={canvasRef} className="max-h-full max-w-full rounded-lg shadow-lg" />
        ) : (
          <div className="text-center text-ink-soft">
            <p className="text-lg font-semibold">🎨 Image Studio</p>
            <p className="mt-1 text-sm">Generate an image from a prompt, or upload one to edit.</p>
          </div>
        )}
        {status && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white shadow-lg">
            {busy && <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white align-middle" />}
            {status}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}
function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="mt-2 block text-xs font-medium text-ink-soft">
      <span className="flex justify-between"><span>{label}</span><span>{value}%</span></span>
      <input type="range" min={0} max={200} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-brand" />
    </label>
  );
}
