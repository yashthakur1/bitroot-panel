import type { Metadata } from "next";
import "./globals.css";
import { ppNeueMontreal, roobert } from "@/lib/fonts";

export const metadata: Metadata = {
  title: "Bitroot Panel",
  description: "Deploy and manage apps on the OnePlus home server.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${ppNeueMontreal.variable} ${roobert.variable}`}>
      <body className="antialiased font-sans" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
