import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  SITE_INSTAGRAM_URL,
  SITE_KEY,
  SITE_TELEGRAM_URL,
  SITE_TIKTOK_URL,
} from "@/lib/siteConfig";

export const EXTERNAL_LINK_KINDS = ["SOCIAL", "MARKETPLACE"] as const;

export type ExternalLinkKind = (typeof EXTERNAL_LINK_KINDS)[number];

export type PublicExternalLink = {
  id: string;
  kind: ExternalLinkKind;
  label: string;
  url: string;
  sortOrder: number;
};

export function normalizeExternalHttpUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

const getStoredExternalLinks = unstable_cache(
  () =>
    prisma.externalLink.findMany({
      where: { siteKey: SITE_KEY },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        kind: true,
        label: true,
        url: true,
        isEnabled: true,
        sortOrder: true,
      },
    }),
  ["public-external-links", SITE_KEY],
  { revalidate: 300, tags: [`external-links:${SITE_KEY}`] },
);

function getEnvironmentFallbackLinks(): PublicExternalLink[] {
  return [
    {
      id: "env-instagram",
      kind: "SOCIAL" as const,
      label: "Instagram",
      url: SITE_INSTAGRAM_URL,
      sortOrder: 10,
    },
    {
      id: "env-telegram",
      kind: "SOCIAL" as const,
      label: "Telegram",
      url: SITE_TELEGRAM_URL,
      sortOrder: 20,
    },
    {
      id: "env-tiktok",
      kind: "SOCIAL" as const,
      label: "TikTok",
      url: SITE_TIKTOK_URL,
      sortOrder: 30,
    },
  ].filter((link) => Boolean(normalizeExternalHttpUrl(link.url)));
}

export async function getPublicExternalLinks(): Promise<PublicExternalLink[]> {
  try {
    const stored = await getStoredExternalLinks();

    // После первого сохранения админка становится единственным источником истины.
    // Это позволяет действительно выключить ссылку, даже если в Vercel осталась старая переменная.
    if (stored.length > 0) {
      return stored.flatMap((link) => {
        const url = normalizeExternalHttpUrl(link.url);
        const kind = EXTERNAL_LINK_KINDS.includes(link.kind as ExternalLinkKind)
          ? (link.kind as ExternalLinkKind)
          : null;

        if (!link.isEnabled || !url || !kind) return [];

        return [
          {
            id: link.id,
            kind,
            label: link.label.trim(),
            url,
            sortOrder: link.sortOrder,
          },
        ];
      });
    }
  } catch {
    // Во время первого preview-деплоя таблица может ещё не существовать.
    // Публичная часть сайта при этом продолжит работать на старых env-настройках.
  }

  return getEnvironmentFallbackLinks();
}
