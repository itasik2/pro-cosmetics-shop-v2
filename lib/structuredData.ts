import {
  getPublicBaseUrl,
  SITE_BRAND,
  SITE_CONTACT_EMAIL,
  SITE_CONTACT_PHONE,
  SITE_DESCRIPTION,
  SITE_INSTAGRAM_URL,
  SITE_TELEGRAM_URL,
  SITE_TIKTOK_URL,
  SITE_TITLE,
} from "@/lib/siteConfig";

export type BreadcrumbItem = {
  name: string;
  url: string;
};

export function absolutePublicUrl(value: string) {
  const baseUrl = getPublicBaseUrl();
  try {
    return new URL(value, `${baseUrl}/`).toString();
  } catch {
    return baseUrl;
  }
}

export function stringifyJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function buildOrganizationJsonLd() {
  const baseUrl = getPublicBaseUrl();
  const sameAs = [SITE_INSTAGRAM_URL, SITE_TELEGRAM_URL, SITE_TIKTOK_URL].filter(
    Boolean,
  );

  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${baseUrl}/#organization`,
    name: SITE_BRAND,
    url: baseUrl,
    logo: absolutePublicUrl("/brand/header-logo.svg"),
    description: SITE_DESCRIPTION,
    ...(SITE_CONTACT_EMAIL ? { email: SITE_CONTACT_EMAIL } : {}),
    ...(SITE_CONTACT_PHONE ? { telephone: SITE_CONTACT_PHONE } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    areaServed: {
      "@type": "Country",
      name: "Казахстан",
    },
  };
}

export function buildWebSiteJsonLd() {
  const baseUrl = getPublicBaseUrl();

  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${baseUrl}/#website`,
    url: baseUrl,
    name: SITE_TITLE,
    description: SITE_DESCRIPTION,
    inLanguage: "ru-KZ",
    publisher: {
      "@id": `${baseUrl}/#organization`,
    },
  };
}

export function buildBreadcrumbJsonLd(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absolutePublicUrl(item.url),
    })),
  };
}

type BlogPostingInput = {
  title: string;
  description: string;
  slug: string;
  image?: string | null;
  category?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function buildBlogPostingJsonLd(input: BlogPostingInput) {
  const baseUrl = getPublicBaseUrl();
  const pageUrl = absolutePublicUrl(`/blog/${encodeURIComponent(input.slug)}`);

  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${pageUrl}#article`,
    headline: input.title,
    description: input.description,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": pageUrl,
    },
    ...(input.image ? { image: [absolutePublicUrl(input.image)] } : {}),
    ...(input.category ? { articleSection: input.category } : {}),
    datePublished: input.createdAt.toISOString(),
    dateModified: input.updatedAt.toISOString(),
    inLanguage: "ru-KZ",
    author: {
      "@id": `${baseUrl}/#organization`,
    },
    publisher: {
      "@id": `${baseUrl}/#organization`,
    },
  };
}
