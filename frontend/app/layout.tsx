import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Geist_Mono, Lexend_Deca } from "next/font/google";
import "./globals.css";
import { ActionAuthProvider } from "@/components/action-auth-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Header } from "@/components/header";
import { TooltipProvider } from "@/components/ui/tooltip";

const lexendDeca = Lexend_Deca({
  variable: "--font-lexend-deca",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Video Streaming Demo",
    template: "%s | Video Streaming Demo",
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      {/*
        `suppressHydrationWarning` on <html> covers only that element's own attributes, not its
        children. Browser extensions and the dev overlay both inject attributes onto <body> —
        `tabindex="-1"` is the common one — which React then reports as a mismatch it cannot patch.
        Suppression here is one level deep, so a genuine mismatch inside the app still surfaces.
      */}
      <body
        suppressHydrationWarning
        className={`${lexendDeca.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            <ActionAuthProvider>
              <Header />
              {children}
              <Analytics />
              <SpeedInsights />
            </ActionAuthProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
