/**
 * Root layout.
 * Server Component — no "use client" directive.
 *
 * Fonts: Geist Sans (body), Geist Mono (labels), Fraunces (editorial display).
 * Motion: LivingBackground (behind) + SmoothScroll (Lenis) wrap the app.
 */
import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Fraunces } from "next/font/google";
import "./globals.css";
import SmoothScroll from "@/components/motion/SmoothScroll";
import LivingBackground from "@/components/motion/LivingBackground";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Chimera — AI-Powered Record Label",
  description:
    "Your AI creative partner. Personal manager, visual design, post writing, and ghostwriting — all in one place.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} ${fraunces.variable} antialiased`}
      >
        <LivingBackground />
        <SmoothScroll>{children}</SmoothScroll>
      </body>
    </html>
  );
}
