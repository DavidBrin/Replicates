import type { Metadata, Viewport } from "next";

import { AppProviders } from "@/components/app-shell/app-providers";

import "./globals.css";

export const metadata: Metadata = {
  title: "fake-phone — never feel alone",
  // Safety framing, never "prank": App Store Review Guideline 1.1.6 bans
  // prank-call apps outright and rejects "for entertainment" disclaimers as a
  // defence (research/competitive-teardown.md §6). The wording here is the
  // wording that would go in a store listing.
  description:
    "A staged incoming call for when you feel unsafe — so it looks like someone knows where you are and is on their way.",
  applicationName: "fake-phone",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "fake-phone",
    // Black-translucent lets the app paint under the status bar, which is what
    // a real full-screen call UI does.
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    // Without this, iOS hyperlinks anything that looks like a phone number —
    // including a caller's number on a call screen, which is an instant tell.
    telephone: false,
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Required for `env(safe-area-inset-*)` to resolve to anything but 0 — the
  // whole notch/home-indicator layout depends on it.
  viewportFit: "cover",
  themeColor: "#0b0b0f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
