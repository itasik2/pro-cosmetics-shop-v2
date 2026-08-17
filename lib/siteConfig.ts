export const SITE_KEY = (process.env.SITE_KEY || "procosmetics").trim();

type SitePreset = {
  brand: string;
  title: string;
  description: string;
  nicheLabel: string;
  heroTitle: string;
  heroSubtitle: string;
  aboutSummary: string;
  aboutGoal: string;
};

const defaultsBySite: Record<string, SitePreset> = {
  procosmetics: {
    brand: "procosmetics.kz",
    title: "Pro Cosmetics — магазин профессиональной косметики",
    description: "Профессиональная косметика и уходовые средства с доставкой по Казахстану.",
    nicheLabel: "профессиональная косметика",
    heroTitle: "Профессиональная косметика для ухода, которая подходит именно вашей коже.",
    heroSubtitle:
      "Подбирайте средства по типу и потребностям кожи. В каждой карточке — назначение, способ применения и понятные рекомендации.",
    aboutSummary:
      "магазин профессиональной косметики для продуманного домашнего ухода. Мы отбираем средства под конкретные задачи кожи и подробно объясняем, как ими пользоваться.",
    aboutGoal:
      "Наша цель — помочь выстроить понятный уход за кожей: от базового очищения и увлажнения до восстановления, антивозрастного ухода и средств для проблемной кожи.",
  },
  fitoapteka: {
    brand: "fitoapteka.kz",
    title: "FitoApteka — аптека и фитопродукты",
    description: "Фитопродукты, БАДы и товары для здоровья с доставкой по Казахстану.",
    nicheLabel: "аптека и фитопродукты",
    heroTitle: "Фитопродукты и товары для здоровья — в одном месте",
    heroSubtitle:
      "Проверенные категории: витамины, фиточаи, БАДы и сопутствующие товары с понятным описанием и аккуратным подбором.",
    aboutSummary:
      "онлайн-витрина фитопродуктов и товаров для здоровья. Мы собираем ассортимент с понятным составом и аккуратной подачей без лишних обещаний.",
    aboutGoal:
      "Наша цель — помочь подобрать понятные товары для ежедневной поддержки здоровья и благополучия без агрессивных маркетинговых обещаний.",
  },
};

const preset = defaultsBySite[SITE_KEY] || defaultsBySite.procosmetics;

export const SITE_BRAND = process.env.NEXT_PUBLIC_SITE_BRAND || preset.brand;
export const SITE_TITLE = process.env.SITE_TITLE || preset.title;
export const SITE_DESCRIPTION = process.env.SITE_DESCRIPTION || preset.description;
export const SITE_NICHE_LABEL = process.env.SITE_NICHE_LABEL || preset.nicheLabel;
export const SITE_HERO_TITLE = process.env.SITE_HERO_TITLE || preset.heroTitle;
export const SITE_HERO_SUBTITLE = process.env.SITE_HERO_SUBTITLE || preset.heroSubtitle;
export const SITE_ABOUT_SUMMARY = process.env.SITE_ABOUT_SUMMARY || preset.aboutSummary;
export const SITE_ABOUT_GOAL = process.env.SITE_ABOUT_GOAL || preset.aboutGoal;

export const SITE_CONTACT_PHONE =
  process.env.NEXT_PUBLIC_CONTACT_PHONE || "+7 (707) 191-91-04";
export const SITE_CONTACT_PHONE_HREF = `tel:${SITE_CONTACT_PHONE.replace(
  /[^\d+]/g,
  "",
)}`;
export const SITE_CONTACT_EMAIL =
  process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() ||
  (SITE_KEY === "procosmetics" ? "sales@procosmetics.kz" : "");
export const SITE_CONTACT_LOCATION =
  process.env.NEXT_PUBLIC_CONTACT_LOCATION?.trim() || "Павлодар, Казахстан";

const contactPhoneDigits = SITE_CONTACT_PHONE.replace(/\D/g, "");

function normalizePublicHttpUrl(value: string | undefined) {
  const raw = value?.trim() || "";
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? raw : "";
  } catch {
    return "";
  }
}

export const SITE_WHATSAPP_URL =
  normalizePublicHttpUrl(process.env.NEXT_PUBLIC_WHATSAPP_URL) ||
  normalizePublicHttpUrl(
    contactPhoneDigits ? `https://wa.me/${contactPhoneDigits}` : "",
  );
export const SITE_INSTAGRAM_URL = normalizePublicHttpUrl(
  process.env.NEXT_PUBLIC_INSTAGRAM_URL,
);
export const SITE_TELEGRAM_URL = normalizePublicHttpUrl(
  process.env.NEXT_PUBLIC_TELEGRAM_URL,
);
export const SITE_TIKTOK_URL = normalizePublicHttpUrl(
  process.env.NEXT_PUBLIC_TIKTOK_URL,
);

export const SITE_ENV_SUFFIX = SITE_KEY.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();

export function getPublicBaseUrl() {
  return (process.env.NEXT_PUBLIC_URL || `https://${SITE_BRAND}`).replace(/\/$/, "");
}

export function getScopedEnv(name: string) {
  return process.env[`${name}_${SITE_ENV_SUFFIX}`] || process.env[name] || "";
}
