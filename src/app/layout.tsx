import type { Metadata } from "next";
import "./globals.css";
import { funnelDisplay, geist, geistMono } from "@/lib/fonts";

export const metadata: Metadata = {
  title: "BitPanel",
  description: "Deploy and manage apps on a machine you own.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${funnelDisplay.variable} ${geist.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased font-sans" suppressHydrationWarning>
        <script
          // Apply stored/system theme before first paint to avoid a flash.
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('bp-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}",
          }}
        />
        {children}
      </body>
    </html>
  );
}
