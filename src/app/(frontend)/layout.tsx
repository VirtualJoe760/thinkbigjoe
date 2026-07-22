import type { Metadata, Viewport } from "next";
import { Roboto } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { AttributionCapture } from "@/components/attribution-capture";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "600", "800"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://thinkbigjoe.com"),
  // The title tag IS the search query for this category. The competitor teardown found the pages
  // that actually rank ("AI Phone Agent for Home Services | Retell AI", "HVAC AI Receptionist &
  // Answering Service – Newo.ai") put the keyword in the title verbatim, while the sites that
  // lead with a clever brand statement rank for nothing but their own name. "Agentic AI & MCP
  // Development" describes a consultancy nobody is searching for.
  title: {
    default: "AI Receptionist for Home Services | ThinkBigJoe",
    template: "%s · ThinkBigJoe",
  },
  description:
    "An AI receptionist that answers every call 24/7 for plumbers, HVAC, electrical and roofing companies — qualifies the caller and texts you the job before you're off the ladder. Website included.",
  openGraph: {
    title: "AI Receptionist for Home Services | ThinkBigJoe",
    description:
      "Answer every call. Book every job. An AI receptionist for home service businesses, 24/7.",
    type: "website",
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ThinkBigJoe",
  },
};

// viewport-fit=cover exposes the env(safe-area-inset-*) vars so the installed PWA's sticky
// header doesn't collide with the notch / home indicator.
export const viewport: Viewport = {
  themeColor: "#0047ff",
  viewportFit: "cover",
};

export default function FrontendLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning on <html>: some extensions inject a class onto the
    // root element itself (e.g. a microformats/reader extension adding `hentry`)
    // before React hydrates — the flag only covers one level, so <html> needs its
    // own (the one on <body> below doesn't reach it).
    <html lang="en" className={`${roboto.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </head>
      {/* suppressHydrationWarning: browser extensions (Grammarly's data-gr-*,
          reader/theme extensions' data-rm-theme) mutate <body> before React
          hydrates, which otherwise logs a benign attribute-mismatch warning. */}
      <body className="min-h-full flex flex-col bg-background text-ink" suppressHydrationWarning>
        {children}
        <Analytics />
        <AttributionCapture />
        <PwaRegister />
      </body>
    </html>
  );
}
