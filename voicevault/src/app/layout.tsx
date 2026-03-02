import type { Metadata } from "next";
import { DM_Sans as RootFont } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/features/theme/theme-provider";
import { LocaleProvider } from "@/features/i18n/locale-provider";
import { ReactQueryProvider } from "@/features/react-query/react-query-provider";

import { cn } from "@/lib/utils";
import { siteMetadata } from "@/lib/site";
import { getLocale, getMessages } from "next-intl/server";

import "./globals.css";
import { NextIntlClientProvider } from "next-intl";

const geistSans = RootFont({
  variable: "--font-root-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = siteMetadata;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  return (
    <html lang='en' className="scroll-smooth" suppressHydrationWarning>
      <body className={cn("antialiased", geistSans.className)}>
        <NextIntlClientProvider>
          <ThemeProvider>
            <ReactQueryProvider>
              {children}
              <Toaster closeButton />
            </ReactQueryProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
