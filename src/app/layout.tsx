import type { Metadata } from "next";
import { Jost } from "next/font/google";
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${jost.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-ink">
        {children}
      </body>
    </html>
  );
}
