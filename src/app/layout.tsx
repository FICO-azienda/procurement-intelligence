import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import { APP_NAME } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "What you buy, what you pay, and how prices are moving.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh">
        <div className="md:grid md:min-h-dvh md:grid-cols-[232px_minmax(0,1fr)]">
          <Sidebar />
          <main className="min-w-0">
            <div className="mx-auto max-w-[1240px] px-4 pt-6 pb-16 sm:px-8 md:pt-9 lg:px-10">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
