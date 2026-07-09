"use client";

import { useEffect, useRef, useState } from "react";

type ToastItem = { id: number; message: string };

/** Fire a transient toast from anywhere on the client. */
export function toast(message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("app:toast", { detail: { message } }));
}

/** Mount once per page; renders a bottom-center stack of auto-dismissing toasts. */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    const onToast = (e: Event) => {
      const message = (e as CustomEvent).detail?.message as string;
      if (!message) return;
      const id = ++idRef.current;
      setItems((cur) => [...cur, { id, message }]);
      setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), 3200);
    };
    window.addEventListener("app:toast", onToast);
    return () => window.removeEventListener("app:toast", onToast);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[100] flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-lg"
          style={{ animation: "toast-in 160ms ease-out" }}
        >
          {t.message}
        </div>
      ))}
      <style>{`@keyframes toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}
