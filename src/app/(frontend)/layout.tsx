import type { Metadata, Viewport } from "next";
import { Jost } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";

const jost = Jost({
  variable: "--font-jost",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://thinkbigjoe.com"),
  title: {
    default: "ThinkBigJoe — Agentic AI & MCP Development",
    template: "%s · ThinkBigJoe",
  },
  description:
    "An AI consulting agency building agentic software and Model Context Protocol (MCP) solutions for businesses ready to think big.",
  openGraph: {
    title: "ThinkBigJoe — Agentic AI & MCP Development",
    description:
      "Agentic software and MCP solutions for businesses ready to think big.",
    type: "website",
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ThinkBigJoe",
  },
};

// viewport-fit=cover exposes the env(safe-area-inset-*) vars used by the mobile bottom bar and
// headers, so the installed PWA doesn't collide with the notch / home indicator.
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
    <html lang="en" className={`${jost.variable} h-full antialiased`}>
      <head>
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </head>
      {/* suppressHydrationWarning: browser extensions (Grammarly's data-gr-*,
          reader/theme extensions' data-rm-theme) mutate <body> before React
          hydrates, which otherwise logs a benign attribute-mismatch warning. */}
      <body className="min-h-full flex flex-col bg-background text-ink" suppressHydrationWarning>
        {children}
        <Analytics />
        <PwaRegister />
      </body>
    </html>
  );
}
