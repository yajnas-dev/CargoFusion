import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Sans_Condensed, IBM_Plex_Mono } from "next/font/google";
import GlobalAlertBar from "./GlobalAlertBar";
import "./globals.css";

// Type system: condensed for headers/nav/labels (dense, technical), plain
// for body prose, mono for every number/id/timestamp — reads as
// instrumentation, not a generic admin template. See docs/FEATURES.md's
// "Design system" note for the rationale.
const plexSans = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexCondensed = IBM_Plex_Sans_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-data",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "CargoFusion ACSA",
  description: "Autonomous Container Search Assistant — prototype demo",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexCondensed.variable} ${plexMono.variable}`}>
      <body>
        <GlobalAlertBar />
        {children}
      </body>
    </html>
  );
}
