import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "VoteChor: The Great Parliament Run",
  description:
    "The votes are missing. The protest is on. Everybody run! A 3D multiplayer satirical protest game — dodge patrols, recover stolen vote tokens, and take down The Great Vote Collector.",
  keywords: ["VoteChor", "3D game", "multiplayer", "satire", "protest game", "browser game"],
  authors: [{ name: "VoteChor Studio" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "VoteChor: The Great Parliament Run",
    description: "The votes are missing. The protest is on. Everybody run!",
    siteName: "VoteChor.app",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "VoteChor: The Great Parliament Run",
    description: "The votes are missing. The protest is on. Everybody run!",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#f2a541",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-[#f5efdc] text-[#1c1a17] overflow-hidden">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
