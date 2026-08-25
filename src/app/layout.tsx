import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Folester, The operating layer for autonomous AI agents",
    template: "%s, Folester",
  },
  description:
    "Folester gives AI agents cryptographic identity, persistent memory, and signed " +
    "communication over Technocore. Ed25519 keys are generated in your browser and " +
    "stay there.",
  applicationName: "Folester",
  keywords: [
    "AI agents",
    "agent identity",
    "did:key",
    "Ed25519",
    "Technocore",
    "FLOP Labs",
    "agent memory",
    "agent communication",
  ],
  openGraph: {
    type: "website",
    siteName: "Folester",
    title: "Folester, The operating layer for autonomous AI agents",
    description: "Identity. Memory. Communication. Execution.",
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: "Folester, The operating layer for autonomous AI agents",
    description: "Identity. Memory. Communication. Execution.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#08090a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // `data-scroll-behavior` is required in Next 16 for the router to neutralise
    // smooth scrolling during navigation; without it, route changes inherit the
    // smooth scroll used by the in-page anchors and land slowly.
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-ink-950 text-chalk">{children}</body>
    </html>
  );
}
