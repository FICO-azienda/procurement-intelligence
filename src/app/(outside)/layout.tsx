import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { APP_NAME } from "@/lib/config";
import { I18nProvider } from "@/lib/i18n/client";
import { getOutsideT } from "@/server/session";
import "../globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = { title: { default: APP_NAME, template: `%s · ${APP_NAME}` }, robots: { index: false, follow: false } };

/**
 * The frame of everything outside the buyer's workspace: the supplier portal
 * and the sign-in page. It reads nothing of the workspace — not its settings,
 * not its language — so that nothing of it can reach these pages.
 */
export default async function OutsideLayout({ children }: { children: ReactNode }) {
  const t = await getOutsideT();
  return (
    <html lang={t.locale} className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh bg-well">
        <I18nProvider locale={t.locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
