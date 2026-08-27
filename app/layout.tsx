import "./globals.css";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import ScrollToTopButton from "@/components/ScrollToTopButton";
import { prisma } from "@/lib/prisma";
import { serializeJsonLd } from "@/lib/seo";
import {
  getPublicBaseUrl,
  SITE_BRAND,
  SITE_CONTACT_EMAIL,
  SITE_CONTACT_LOCATION,
  SITE_CONTACT_PHONE,
  SITE_DESCRIPTION,
  SITE_INSTAGRAM_URL,
  SITE_KEY,
  SITE_TELEGRAM_URL,
  SITE_TIKTOK_URL,
  SITE_TITLE,
  SITE_WHATSAPP_URL,
} from "@/lib/siteConfig";
import { normalizeThemeProfile } from "@/lib/themeProfiles";
import Providers from "./providers";

const LEGACY_SETTINGS_ID = "default";
const PUBLIC_BASE_URL = getPublicBaseUrl();

export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_BASE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "ru_KZ",
    url: PUBLIC_BASE_URL,
    siteName: SITE_BRAND,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  icons: {
    icon: [
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
      { url: "/brand/favicon_multi_tight.ico" },
    ],
  },
};

function activeNow(settings: {
  scheduleEnabled: boolean;
  scheduleStart: Date | string | null;
  scheduleEnd: Date | string | null;
}) {
  if (!settings.scheduleEnabled) return true;

  const now = Date.now();
  const start = settings.scheduleStart
    ? new Date(settings.scheduleStart).getTime()
    : null;
  const end = settings.scheduleEnd
    ? new Date(settings.scheduleEnd).getTime()
    : null;
  if (start !== null && now < start) return false;
  if (end !== null && now > end) return false;
  return true;
}

const getThemeSettings = unstable_cache(
  async () =>
    (await prisma.themeSettings.findUnique({ where: { id: SITE_KEY } })) ||
    (SITE_KEY === LEGACY_SETTINGS_ID
      ? null
      : prisma.themeSettings.findUnique({
          where: { id: LEGACY_SETTINGS_ID },
        })),
  ["public-theme-settings", SITE_KEY],
  { revalidate: 300, tags: [`theme-settings:${SITE_KEY}`] },
);

function safeHttpUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? raw : "";
  } catch {
    return "";
  }
}

function safeBannerHref(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return safeHttpUrl(raw);
}

function siteStructuredData() {
  const sameAs = [
    SITE_INSTAGRAM_URL,
    SITE_TELEGRAM_URL,
    SITE_TIKTOK_URL,
    SITE_WHATSAPP_URL,
  ].filter(Boolean);

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${PUBLIC_BASE_URL}/#organization`,
        name: SITE_BRAND,
        url: PUBLIC_BASE_URL,
        email: SITE_CONTACT_EMAIL || undefined,
        telephone: SITE_CONTACT_PHONE || undefined,
        address: SITE_CONTACT_LOCATION || undefined,
        sameAs: sameAs.length ? sameAs : undefined,
      },
      {
        "@type": "WebSite",
        "@id": `${PUBLIC_BASE_URL}/#website`,
        url: PUBLIC_BASE_URL,
        name: SITE_BRAND,
        description: SITE_DESCRIPTION,
        inLanguage: "ru-KZ",
        publisher: { "@id": `${PUBLIC_BASE_URL}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${PUBLIC_BASE_URL}/shop?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let settings: Awaited<ReturnType<typeof getThemeSettings>> = null;
  try {
    settings = await getThemeSettings();
  } catch {
    settings = null;
  }

  const isOn = Boolean(
    settings &&
      activeNow({
        scheduleEnabled: settings.scheduleEnabled,
        scheduleStart: settings.scheduleStart,
        scheduleEnd: settings.scheduleEnd,
      }),
  );
  const backgroundUrl = isOn ? safeHttpUrl(settings?.backgroundUrl) : "";
  const themeProfile = isOn
    ? normalizeThemeProfile(settings?.themeProfile)
    : "neutral";
  const bannerText =
    isOn && settings?.bannerEnabled
      ? String(settings.bannerText || "").trim()
      : "";
  const bannerHref = safeBannerHref(settings?.bannerHref);
  const umamiId = process.env.UMAMI_WEBSITE_ID;

  return (
    <html lang="ru" data-theme={themeProfile}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(siteStructuredData()) }}
        />
        {umamiId ? (
          <script
            defer
            src="https://cloud.umami.is/script.js"
            data-website-id={umamiId}
          />
        ) : null}
      </head>

      <body className="min-h-screen">
        {backgroundUrl ? (
          <div
            className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${JSON.stringify(backgroundUrl)})` }}
            aria-hidden="true"
          />
        ) : null}

        <div className="site-frame relative z-10 flex min-h-screen flex-col">
          <Providers>
            <Navbar />

            {bannerText ? (
              <div className="border-b border-[var(--color-border)] bg-[var(--color-accent-soft)]">
                <div className="container flex items-center justify-between gap-3 py-2 text-sm text-[var(--color-text)]">
                  <div className="min-w-0 truncate">{bannerText}</div>
                  {bannerHref ? (
                    <a href={bannerHref} className="text-link whitespace-nowrap">
                      Подробнее
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}

            <main id="main-content" className="container flex-1 py-8" tabIndex={-1}>
              {children}
            </main>
            <Footer />
            <ScrollToTopButton />
          </Providers>
        </div>
      </body>
    </html>
  );
}
