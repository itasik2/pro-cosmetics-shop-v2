export const SITE_KEY = (process.env.SITE_KEY || "procosmetics").trim();

const defaultsBySite: Record<string, { brand: string; title: string; description: string }> = {
  procosmetics: {
    brand: "procosmetics.kz",
    title: "Pro Cosmetics — магазин профессиональной косметики",
    description: "Профессиональная косметика и уходовые средства с доставкой по Казахстану.",
  },
  fitoapteka: {
    brand: "fitoapteka.kz",
    title: "FitoApteka — аптека и фитопродукты",
    description: "Фитопродукты, БАДы и товары для здоровья с удобной доставкой.",
  },
};

const preset = defaultsBySite[SITE_KEY] || defaultsBySite.procosmetics;

export const SITE_BRAND = process.env.NEXT_PUBLIC_SITE_BRAND || preset.brand;
export const SITE_TITLE = process.env.SITE_TITLE || preset.title;
export const SITE_DESCRIPTION = process.env.SITE_DESCRIPTION || preset.description;

export const SITE_ENV_SUFFIX = SITE_KEY.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();

export function getPublicBaseUrl() {
  return (process.env.NEXT_PUBLIC_URL || `https://${SITE_BRAND}`).replace(/\/$/, "");
}

export function getScopedEnv(name: string) {
  return process.env[`${name}_${SITE_ENV_SUFFIX}`] || process.env[name] || "";
}
