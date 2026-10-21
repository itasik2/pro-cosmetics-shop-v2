import type { MatchableProduct } from "./matchProduct";
import { scoreProductMatch } from "./matchProduct";
import {
  extractImagesForSku,
  extractImagesForNamedProduct,
  extractProductFromHtml,
} from "./extractProduct";
import { hasManufacturerSku, namePhotoKey } from "./photoIdentity";
import {
  findOfficialProductUrl,
  findExternalProductUrl,
} from "./openaiResponses";
import { safeFetchHtml, type AllowedSourcePolicy } from "./network";
import { remainingTime } from "./timeBudget";
import { photoSku, type VariantImageCandidate } from "./variantImages";
import {
  catalogProductUrls,
  officialCatalogSearchUrls,
  namedBrandCatalogUrls,
  catalogConfirmsProductBrand,
} from "./officialCatalogSearch";
import { variantPhotoSearchIssue } from "./clientMessages";
import { sourceUrlKey } from "./resolveProductSource";

type SearchResult = { found: boolean; url: string | null };
type Dependencies = {
  official: (
    input: Parameters<typeof findOfficialProductUrl>[0],
  ) => Promise<SearchResult>;
  external: (
    input: Parameters<typeof findExternalProductUrl>[0],
  ) => Promise<SearchResult>;
  fetchHtml: typeof safeFetchHtml;
};
export function productForVariant(
  product: MatchableProduct,
  variant: { sku?: string; label: string },
): MatchableProduct {
  const label =
    /^\d+(?:[.,]\d+)?$/.test(variant.label.trim()) && product.volumeUnit
      ? variant.label.trim() + " " + product.volumeUnit
      : variant.label;
  const volume = (label || product.name).match(
    /(\d+(?:[.,]\d+)?)\s*(мл|ml|л|l|г|гр\.?|g|кг|kg)(?=$|\s|[()])/iu,
  );
  const unit = volume?.[2].toLowerCase();
  const value = volume ? Number(volume[1].replace(",", ".")) : null;
  const mass = unit && /^(?:г|гр\.?|g|кг|kg)$/.test(unit);
  const multiplier = unit && /^(?:л|l|кг|kg)$/.test(unit) ? 1000 : 1;
  const baseName = product.name
    .replace(
      /\s*\(?\d+(?:[.,]\d+)?\s*(?:мл|ml|г|гр\.?|g|л|l|кг|kg)\)?\s*$/iu,
      "",
    )
    .trim();
  return {
    ...product,
    name: baseName + " " + label,
    supplierSku: variant.sku || null,
    barcode: null,
    volumeValue: value === null ? null : value * multiplier,
    volumeUnit: volume ? (mass ? "g" : "ml") : null,
  };
}
export async function searchVariantPhotos(
  input: {
    product: MatchableProduct;
    variant: { sku?: string; label: string };
    knownUrl?: string | null;
    knownUrls?: string[];
    officialDomains: string[];
    policies: AllowedSourcePolicy[];
    priceCandidates: VariantImageCandidate[];
    deadlineAt?: number;
    catalogOnly?: boolean;
    excludedUrls?: string[];
  },
  dependencies: Dependencies = {
    official: findOfficialProductUrl,
    external: findExternalProductUrl,
    fetchHtml: safeFetchHtml,
  },
) {
  const product = productForVariant(input.product, input.variant);
  const sku = input.variant.sku || "";
  const byName = !hasManufacturerSku(sku);
  if (byName && (!input.product.name || !input.product.brand?.name))
    throw new Error("photo_product_identity_required");
  if (byName) product.supplierSku = null;
  const deadlineAt = input.deadlineAt ?? Date.now() + 140_000;
  const candidates: VariantImageCandidate[] = [];
  const errors: string[] = [];
  const rejections = new Set<string>();
  const brandCatalogs = new Map<
    string,
    ReturnType<Dependencies["fetchHtml"]>
  >();
  const tried = new Set<string>(input.excludedUrls || []);
  const triedKeys = new Set([...tried].map(sourceUrlKey));
  async function inspect(url: string, discovered = false, until = deadlineAt) {
    if (triedKeys.has(sourceUrlKey(url))) return false;
    tried.add(url);
    triedKeys.add(sourceUrlKey(url));
    try {
      if (
        ["procosmetics.kz", "www.procosmetics.kz"].includes(
          new URL(url).hostname.toLowerCase(),
        )
      )
        return false;
      const policies = discovered
        ? [
            ...input.policies,
            { domain: new URL(url).hostname, allowSubdomains: false },
          ]
        : input.policies;
      const fetched = await dependencies.fetchHtml(url, policies, {
        timeoutMs: remainingTime(until, 12_000),
      });
      const extracted = extractProductFromHtml({
        buffer: fetched.buffer,
        finalUrl: fetched.finalUrl,
        expectedSku: sku,
      });
      const match = scoreProductMatch(product, extracted);
      const pageIssues = new Set<string>();
      let images = byName
        ? extractImagesForNamedProduct({
            buffer: fetched.buffer,
            finalUrl: fetched.finalUrl,
            product,
            issues: pageIssues,
          })
        : extractImagesForSku({
            buffer: fetched.buffer,
            finalUrl: fetched.finalUrl,
            sku,
            brand: product.brand?.name || product.supplier?.name,
          });
      if (byName && !images.length) {
        const brand = product.brand!.name;
        const pendingBrandImages = extractImagesForNamedProduct({
          buffer: fetched.buffer,
          finalUrl: fetched.finalUrl,
          product,
          confirmedBrand: brand,
        });
        if (pendingBrandImages.length) {
          for (const catalogUrl of namedBrandCatalogUrls(
            fetched.buffer,
            fetched.finalUrl,
            brand,
            product.name,
          )) {
            try {
              let request = brandCatalogs.get(catalogUrl);
              if (!request) {
                if (brandCatalogs.size >= 4) break;
                request = dependencies.fetchHtml(catalogUrl, policies, {
                  timeoutMs: remainingTime(until, 8_000),
                });
                brandCatalogs.set(catalogUrl, request);
              }
              const catalog = await request;
              if (
                catalogConfirmsProductBrand(
                  catalog.buffer,
                  catalog.finalUrl,
                  fetched.finalUrl,
                  brand,
                )
              ) {
                images = pendingBrandImages;
                break;
              }
            } catch (error) {
              errors.push(
                error instanceof Error ? error.message : String(error),
              );
            }
          }
        }
      }
      if (
        !byName &&
        (photoSku(extracted.sku) !== photoSku(sku) ||
          match.evidence.brand === "mismatch" ||
          match.evidence.volume === "mismatch")
      )
        return false;
      if (byName && !images.length)
        pageIssues.forEach((issue) => rejections.add(issue));
      candidates.push(
        ...images.map((image) => ({
          url: image,
          source: "WEB" as const,
          sourceUrl: fetched.finalUrl,
          ...(byName
            ? { identityKey: namePhotoKey(input.product, input.variant) }
            : {}),
        })),
      );
      return images.length > 0;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return false;
    }
  }
  // Reuse a saved page only after checking the SKU or exact name and size.
  for (const url of [
    ...new Set(
      [...(input.knownUrls || []), input.knownUrl].filter(
        (url): url is string => Boolean(url),
      ),
    ),
  ].slice(0, 3)) {
    if (await inspect(url)) break;
  }
  if (!candidates.length && !byName) {
    const catalogDeadline = Math.min(deadlineAt, Date.now() + 35_000);
    for (const url of officialCatalogSearchUrls(input.officialDomains, sku)) {
      try {
        const page = await dependencies.fetchHtml(url, input.policies, {
          timeoutMs: remainingTime(catalogDeadline, 8_000),
        });
        for (const productUrl of catalogProductUrls(
          page.buffer,
          page.finalUrl,
        )) {
          if (await inspect(productUrl, false, catalogDeadline)) break;
        }
        if (candidates.length) break;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  if (!candidates.length && !input.catalogOnly) {
    const stages: ("official" | "external")[] = ["official", "external"];
    if (byName) stages.push("external");
    for (const stage of stages) {
      if (stage === "official" && !input.officialDomains.length) continue;
      try {
        const timeoutMs = remainingTime(deadlineAt, 40_000);
        const found =
          stage === "official"
            ? await dependencies.official({
                product,
                allowedDomains: input.officialDomains,
                excludedUrls: [...tried],
                timeoutMs,
                purpose: "PHOTO",
              })
            : await dependencies.external({
                product,
                officialDomainsTried: input.officialDomains,
                excludedUrls: [...tried],
                timeoutMs,
                purpose: "PHOTO",
              });
        if (!found.found && stage === "external") break;
        if (found.found && found.url && (await inspect(found.url, true))) break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
        if (/openai_(?:not_configured|http_(?:400|401|403|429))/.test(message))
          break;
      }
    }
  }
  // Web photos take precedence; exact-SKU price rows are the reserve.
  candidates.push(...input.priceCandidates);
  const unique = [
    ...new Map(
      candidates.map((candidate) => [candidate.url, candidate]),
    ).values(),
  ].slice(0, 12);
  const issues = [
    ...new Map(
      [...errors, ...rejections].map((error) => {
        const issue = variantPhotoSearchIssue(error);
        return [issue.code, issue] as const;
      }),
    ).values(),
  ];
  return {
    sku,
    candidates: unique,
    status: unique.length
      ? ("FOUND" as const)
      : errors.length
        ? ("INCOMPLETE" as const)
        : ("NOT_FOUND" as const),
    // Send safe, actionable diagnostics; provider response bodies stay private.
    issues,
  };
}
