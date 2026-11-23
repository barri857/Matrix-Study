import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Matrix — Make knowledge yours",
  description: "Your personal AI study workspace. Study guides, spaced flashcards, practice tests, and your own AI.",
  icons: { icon: "/favicon.svg", apple: { url: "/apple-touch-icon.png", sizes: "180x180" } },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Matrix" },
};
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
