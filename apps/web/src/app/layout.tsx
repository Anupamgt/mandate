import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, Mulish } from "next/font/google";
import "./globals.css";

const mulish = Mulish({
  subsets: ["latin"],
  variable: "--font-mulish",
  weight: ["400", "500", "600", "700", "800"],
});

const ibm = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-ibm",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Mandate — operator console",
  description: "Bounded, revocable spending authority for AI agents on Razorpay test mode.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${mulish.variable} ${ibm.variable} antialiased`}>{children}</body>
    </html>
  );
}
