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
    heroTitle: "Профессиональная косметика с любовью для Вас!",
    heroSubtitle:
      "Только проверенные позиции. Нормальные составы, честные описания и цены без магии маркетинга.",
    aboutSummary:
      "небольшой магазин профессиональной косметики для домашнего ухода. Мы подбираем рабочие средства с понятными составами и честными описаниями.",
    aboutGoal:
      "Наша цель — помочь вам выстроить простой и рабочий уход за кожей: от базового очищения до анти-эйдж и средств для проблемной кожи.",
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

export const SITE_ENV_SUFFIX = SITE_KEY.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();

export function getPublicBaseUrl() {
  return (process.env.NEXT_PUBLIC_URL || `https://${SITE_BRAND}`).replace(/\/$/, "");
}

export function getScopedEnv(name: string) {
  return process.env[`${name}_${SITE_ENV_SUFFIX}`] || process.env[name] || "";
}
