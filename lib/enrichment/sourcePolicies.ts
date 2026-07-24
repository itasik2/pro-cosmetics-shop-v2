import { prisma } from "@/lib/prisma";
import type { AllowedSourcePolicy } from "./network";
import type { SourceSelectors } from "./extractProduct";

function normalizeDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

function normalizeHint(value: string | null | undefined) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, "");
}

export function selectorsFromJson(value: unknown): SourceSelectors | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  const selectors: SourceSelectors = {};

  for (const key of [
    "title",
    "description",
    "ingredients",
    "application",
    "images",
  ] as const) {
    if (typeof object[key] === "string" && object[key].trim()) {
      selectors[key] = object[key].trim();
    }
  }

  return Object.keys(selectors).length ? selectors : null;
}

export async function ensureDefaultSupplierSources(input: {
  supplierId: string;
  supplierSlug: string;
  supplierName?: string | null;
  brandName?: string | null;
}) {
  const supplierHint = normalizeHint(`${input.supplierSlug} ${input.supplierName || ""}`);
  const brandHint = normalizeHint(input.brandName);
  const defaults: Array<{
    name: string;
    domain: string;
    baseUrl: string;
    priority: number;
  }> = [];

  if (
    supplierHint.includes("angiopharm") ||
    supplierHint.includes("ангиофарм") ||
    brandHint.includes("angiopharm") ||
    brandHint.includes("ангиофарм")
  ) {
    defaults.push(
      {
        name: "ANGIOPHARM Казахстан",
        domain: "angiopharm.kz",
        baseUrl: "https://angiopharm.kz",
        priority: 20,
      },
      {
        name: "ANGIOPHARM производитель",
        domain: "angiopharm.com",
        baseUrl: "https://angiopharm.com",
        priority: 10,
      },
    );
  }

  if (
    brandHint.includes("mesaltera") ||
    brandHint.includes("мезальтера")
  ) {
    defaults.push({
      name: "Laboratory THOSCANE, производитель MESALTERA",
      domain: "thoscane.ru",
      baseUrl: "https://thoscane.ru/products/",
      priority: 20,
    });
  }

  for (const source of defaults) {
    await prisma.supplierSource.upsert({
      where: {
        supplierId_domain: {
          supplierId: input.supplierId,
          domain: source.domain,
        },
      },
      update: {
        name: source.name,
        baseUrl: source.baseUrl,
        isEnabled: true,
        priority: source.priority,
      },
      create: {
        supplierId: input.supplierId,
        name: source.name,
        domain: source.domain,
        baseUrl: source.baseUrl,
        sourceType: "OFFICIAL_SITE",
        allowSubdomains: true,
        isEnabled: true,
        priority: source.priority,
      },
    });
  }
}

export async function getEnabledSupplierSources(supplierId: string) {
  return prisma.supplierSource.findMany({
    where: { supplierId, isEnabled: true },
    orderBy: [{ priority: "desc" }, { name: "asc" }],
  });
}

export function toAllowedPolicies(
  sources: Array<{ domain: string; allowSubdomains: boolean }>,
): AllowedSourcePolicy[] {
  return sources.map((source) => ({
    domain: normalizeDomain(source.domain),
    allowSubdomains: source.allowSubdomains,
  }));
}

export function findSourceForUrl<
  T extends { domain: string; allowSubdomains: boolean },
>(sources: T[], rawUrl: string): T | null {
  let hostname: string;
  try {
    hostname = normalizeDomain(new URL(rawUrl).hostname);
  } catch {
    return null;
  }

  return (
    sources.find((source) => {
      const domain = normalizeDomain(source.domain);
      return (
        hostname === domain ||
        (source.allowSubdomains && hostname.endsWith(`.${domain}`))
      );
    }) || null
  );
}

export function normalizedSourceDomain(value: string) {
  return normalizeDomain(value);
}
