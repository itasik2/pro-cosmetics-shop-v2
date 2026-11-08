import { requestLocale } from "@/lib/i18nServer";
import { uiText, localizedHref } from "@/lib/i18n";
import Link from "next/link";
import { CARE_OPTIONS, CATEGORY_OPTIONS } from "@/lib/catalogFilters";
import { SITE_BRAND, getPublicBaseUrl, SITE_WHATSAPP_URL } from "@/lib/siteConfig";

export const metadata = {
  title: `Подобрать уход — ${SITE_BRAND}`,
  description: "Выберите задачу ухода, тип средства и бюджет, чтобы сузить каталог.",
  alternates: { canonical: `${getPublicBaseUrl()}/care` },
};

export default async function CarePage() {
  const locale = await requestLocale();
  const t = (value: string) => uiText(locale, value);
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-8">
      <div>
        <p className="site-eyebrow">{t("Подбор ухода")}</p>
        <h1 className="mt-3 text-3xl font-bold">{t("Найдите средства под свою задачу")}</h1>
        <p className="mt-3 text-base leading-7 text-gray-600">{t("Выберите потребность кожи и бюджет. Покажем товары с соответствующим назначением в описании.")}</p>
      </div>
      <form action={localizedHref("/shop",locale)} method="get" className="site-panel space-y-5 rounded-3xl p-6">
        <label className="block space-y-2">
          <span className="block font-semibold">{t("Что нужно вашей коже?")}</span>
          <select name="care" className="w-full rounded-xl border bg-white p-3">
            <option value="">{t("Все задачи")}</option>
            {CARE_OPTIONS.map((option) => <option key={option.slug} value={option.slug}>{t(option.label)}</option>)}
          </select>
        </label>
        <label className="block space-y-2">
          <span className="block font-semibold">{t("Тип средства")}</span>
          <select name="category" className="w-full rounded-xl border bg-white p-3">
            <option value="">{t("Все средства")}</option>
            {CATEGORY_OPTIONS.map((option) => <option key={option.slug} value={option.slug}>{t(option.label)}</option>)}
          </select>
        </label>
        <label className="block space-y-2">
          <span className="block font-semibold">{t("Бюджет на одно средство")}</span>
          <select name="maxPrice" className="w-full rounded-xl border bg-white p-3">
            <option value="">{t("Без ограничения")}</option>
            {[5000, 10000, 20000, 30000].map((price) => <option key={price} value={price}>{locale === "kk" ? `${price.toLocaleString("kk-KZ")} ₸ дейін` : locale === "en" ? `Up to ${price.toLocaleString("en-US")} ₸` : `До ${price.toLocaleString("ru-RU")} ₸`}</option>)}
          </select>
        </label>
        <input type="hidden" name="instock" value="1" />
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="btn">{t("Показать подходящие товары")}</button>
          <button type="submit" formAction={localizedHref("/ask",locale)} name="q" value={locale === "kk" ? "Күтім құралын таңдауға көмектес" : locale === "en" ? "Help me choose skincare" : "Помоги выбрать средство"} className="btn-secondary">{t("Обсудить выбор с ИИ")}</button>
        </div>
        <p className="text-sm leading-6 text-gray-600">{t("Подбор помогает найти товары, но не определяет совместимость активных средств. Если уход назначен специалистом, следуйте его рекомендациям.")}</p>
      </form>
      <div className="flex flex-wrap gap-3">
        <Link href={localizedHref("/shop", locale)} className="btn-secondary">{t("Весь каталог")}</Link>
        {SITE_WHATSAPP_URL && <a href={SITE_WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="btn-secondary">{t("Помощь с выбором в WhatsApp")}</a>}
      </div>
    </div>
  );
}
