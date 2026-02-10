// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Providers from "./providers";
import { prisma } from "@/lib/prisma";
import { SITE_DESCRIPTION, SITE_KEY, SITE_TITLE } from "@/lib/siteConfig";

const LEGACY_SETTINGS_ID = "default";

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
};

function activeNow(s: {
  scheduleEnabled: boolean;
  scheduleStart: Date | null;
  scheduleEnd: Date | null;
}) {
  if (!s.scheduleEnabled) return true;

  const now = Date.now();
  const start = s.scheduleStart ? s.scheduleStart.getTime() : null;
  const end = s.scheduleEnd ? s.scheduleEnd.getTime() : null;

  if (start !== null && now < start) return false;
  if (end !== null && now > end) return false;
  return true;
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // читаем настройки; если модели еще нет/миграция не применена — сайт не падает
  let settings: any = null;
  try {
    settings =
      (await prisma.themeSettings.findUnique({
        where: { id: SITE_KEY },
      })) ||
      (SITE_KEY === LEGACY_SETTINGS_ID
        ? null
        : await prisma.themeSettings.findUnique({ where: { id: LEGACY_SETTINGS_ID } }));
  } catch {
    settings = null;
  }

  const isOn =
    settings &&
    activeNow({
      scheduleEnabled: !!settings.scheduleEnabled,
      scheduleStart: settings.scheduleStart ?? null,
      scheduleEnd: settings.scheduleEnd ?? null,
    });

  const backgroundUrl =
    isOn && settings?.backgroundUrl ? String(settings.backgroundUrl).trim() : "";

  const bannerEnabled = isOn && !!settings?.bannerEnabled;
  const bannerText = bannerEnabled
    ? String(settings?.bannerText || "").trim()
    : "";
  const bannerHref = bannerEnabled
    ? String(settings?.bannerHref || "").trim()
    : "";

  const umamiId = process.env.UMAMI_WEBSITE_ID;

  return (
    <html lang="ru">
      <head>
        {umamiId ? (
          <script
            defer
            src="https://cloud.umami.is/script.js"
            data-website-id={umamiId}
          />
        ) : null}
      </head>

      <body className="min-h-screen">
        {/* ФОН */}
        {backgroundUrl ? (
          <div
            className="fixed inset-0 -z-10 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${backgroundUrl})` }}
            aria-hidden="true"
          />
        ) : null}

        {/* Контент */}
        <div className="min-h-screen flex flex-col bg-white/85">
          <Providers>
            <Navbar />

            {bannerEnabled && bannerText ? (
              <div className="border-b bg-white/80 backdrop-blur">
                <div className="container mx-auto py-2 text-sm text-gray-800 flex items-center justify-between gap-3">
                  <div className="truncate">{bannerText}</div>
                  {bannerHref ? (
                    <a
                      href={bannerHref}
                      className="text-sm font-semibold hover:underline whitespace-nowrap"
                    >
                      Подробнее
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}

            <main className="container py-8 flex-1">{children}</main>
            <Footer />
          </Providers>
        </div>
      </body>
    </html>
  );
}
