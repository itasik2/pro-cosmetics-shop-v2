// app/ask/page.tsx
import { Suspense } from "react";
import type { Metadata } from "next";
import AskClient from "./AskClient";
import { getPublicBaseUrl, SITE_BRAND } from "@/lib/siteConfig";

export const dynamic = "force-dynamic";

const askUrl = `${getPublicBaseUrl()}/ask`;
const description =
  "Задайте вопрос о товаре, назначении и применении профессиональной косметики из каталога.";

export const metadata: Metadata = {
  title: `Вопросы о косметике — ${SITE_BRAND}`,
  description,
  alternates: { canonical: askUrl },
  openGraph: {
    type: "website",
    url: askUrl,
    title: `Вопросы о косметике — ${SITE_BRAND}`,
    description,
  },
  twitter: {
    card: "summary",
    title: `Вопросы о косметике — ${SITE_BRAND}`,
    description,
  },
};

export default function AskPage() {
  return (
    <Suspense fallback={<div className="py-8 text-sm text-gray-500">Загрузка…</div>}>
      <AskClient />
    </Suspense>
  );
}
