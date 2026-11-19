import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Matrix — Make knowledge yours", description: "Your personal AI study workspace. Study guides, spaced flashcards, practice tests, and your own AI.", icons: { icon: "/favicon.svg" }, manifest: "/manifest.webmanifest" };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
