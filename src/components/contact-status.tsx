"use client";

import { useEffect, useState } from "react";

export function ContactStatus() {
  const [state, setState] = useState<"sent" | "error" | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("sent") === "1") setState("sent");
    else if (p.get("error") === "contact") setState("error");
  }, []);

  if (!state) return null;

  if (state === "sent") {
    return (
      <div className="mb-5 rounded-xl border border-brand/40 bg-brand/10 px-4 py-3 text-sm text-white">
        Thanks — your message is in. I&apos;ll get back to you personally, usually within a day.
      </div>
    );
  }
  return (
    <div className="mb-5 rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white/80">
      Something was off with the form — please add your name, a valid email, and a message.
    </div>
  );
}
