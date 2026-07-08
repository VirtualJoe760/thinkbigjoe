import type { Metadata } from "next";
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

export default function FrontendLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${jost.variable} h-full antialiased`}>
      <head>
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="theme-color" content="#0047ff" />
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
