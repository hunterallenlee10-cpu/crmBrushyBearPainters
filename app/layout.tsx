import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ZodConfig } from "@/components/zod-config";
import { lilita, manrope } from "./fonts";

export const metadata: Metadata = {
  title: { default: "Brushy Bear CRM", template: "%s · Brushy Bear CRM" },
  description: "Internal operating system for Brushy Bear Painters.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#1F4D3A",
  width: "device-width",
  initialScale: 1,
};

/**
 * Reading the request headers renders every page per request, so Next.js can
 * put the middleware's CSP nonce on its scripts (SPEC §13.1). The offline
 * fallback page stays static (it needs no scripts).
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers();
  return (
    <html lang="en" className={`${manrope.variable} ${lilita.variable}`}>
      <body>
        <ZodConfig />
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
