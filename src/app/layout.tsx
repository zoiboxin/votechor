import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const SITE_URL = "https://votechor.app";
const TITLE = "VoteChor: The Great Parliament Run — Free 3D Multiplayer Browser Game";
const DESCRIPTION =
  "VoteChor is a free 3D multiplayer satirical protest game you can play instantly in your browser — no download, no install. Dodge police patrols and searchlights, snatch back the stolen vote tokens with your crowd, outrun The Great Vote Collector, and run the rails of Parliament City. Play solo or online with friends on votechor.app.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s | VoteChor",
  },
  description: DESCRIPTION,
  applicationName: "VoteChor",
  generator: "Next.js",
  referrer: "origin-when-cross-origin",
  keywords: [
    "VoteChor",
    "votechor.app",
    "free browser game",
    "3D multiplayer game",
    "multiplayer browser game",
    "online game no download",
    "protest game",
    "satire game",
    "satirical game",
    "endless runner game",
    "stealth game",
    "party game online",
    "play with friends online",
    "crowd game",
    "democracy game",
    "vote game",
    "election game",
    "browser games free",
    "web game 3D",
    "instant play game",
  ],
  authors: [{ name: "VoteChor Studio", url: SITE_URL }],
  creator: "VoteChor Studio",
  publisher: "VoteChor Studio",
  category: "games",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
      { url: "/icons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    other: [
      { rel: "mask-icon", url: "/logo.svg", color: "#f2a541" },
    ],
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "VoteChor",
    locale: "en_US",
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: "/brand/og-image.png",
        width: 1200,
        height: 630,
        alt: "VoteChor — cartoon protesters sprint through Parliament City clutching glowing golden ballots while a comic police officer and searchlights give chase, in Subway-Surfers-style 3D art",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@votechor",
    creator: "@votechor",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/brand/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  appleWebApp: {
    capable: true,
    title: "VoteChor",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    "apple-mobile-web-app-title": "VoteChor",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#f2a541",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://votechor.app" />
      </head>
      <body className="antialiased bg-[#f5efdc] text-[#1c1a17] overflow-hidden">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
