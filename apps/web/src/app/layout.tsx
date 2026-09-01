import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Mandate — operator console",
  description: "Bounded, revocable, audited spending authority for AI agents.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geist.variable} antialiased`}>{children}</body>
    </html>
  );
}
