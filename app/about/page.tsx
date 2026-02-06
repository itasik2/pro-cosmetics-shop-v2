// app/about/page.tsx
import { SITE_ABOUT_GOAL, SITE_ABOUT_SUMMARY, SITE_BRAND, SITE_NICHE_LABEL } from "@/lib/siteConfig";
export const metadata = {
  title: `О нас – ${SITE_BRAND}`,
  description:
    `${SITE_BRAND} — ${SITE_NICHE_LABEL}.`,
};

export default function AboutPage() {
  return (
    <div className="space-y-4 py-6">
      <h1 className="text-3xl font-bold">О нас</h1>
      <p className="text-gray-700">
        {SITE_BRAND} — это {SITE_ABOUT_SUMMARY}
      </p>
      <p className="text-gray-700">
        {SITE_ABOUT_GOAL}
      </p>
    </div>
  );
}
