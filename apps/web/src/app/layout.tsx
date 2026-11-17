import type { Metadata, Viewport } from "next";
import { PwaProvider } from "@/components/pwa-provider";
import "./globals.css";
import { APP_VERSION } from "@/server/version";

// The CSP nonce is per request, so pages cannot be prerendered (M9 scope 4).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Kash",
  description: "Open-source, self-hostable budgeting.",
  manifest: "/manifest.webmanifest",
  icons: { apple: "/icons/apple-touch-icon.png" },
  other: { "apple-mobile-web-app-capable": "yes" },
  appleWebApp: {
    capable: true,
    title: "Kash",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#111111",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <PwaProvider />
        {children}
        <footer className="mx-auto max-w-6xl p-4 pb-24 text-xs text-muted-foreground md:pb-4">
          Kash {APP_VERSION} ·{" "}
          <a
            className="underline"
            href="https://github.com/kashyapcodes-dev/kash-spending-tracker"
            target="_blank"
            rel="noopener noreferrer"
          >
            Source code (AGPL-3.0)
          </a>
        </footer>
      </body>
    </html>
  );
}
