import { z } from "zod";
import { extractProductFromHtml } from "./extractProduct";
import { scoreProductMatch, type MatchableProduct } from "./matchProduct";
import { safeFetchHtml } from "./network";
import { separateProductSections } from "../product-sections";
import {
  fallbackDescription, findExternalProductUrl, findOfficialBrandSite,
  findOfficialProductUrl, generateProductDescription, validatedExternalProductUrl,
} from "./openaiResponses";

export const sharedSearchInput = z.object({
  product: z.object({
    sku: z.string().trim().min(1).max(100),
    title: z.string().trim().min(2).max(500),
    brand: z.string().trim().max(120).optional(),
    barcode: z.string().trim().max(100).optional(),
    volumeValue: z.number().positive().max(100_000).optional(),
    volumeUnit: z.string().trim().max(20).optional(),
  }),
  sourceUrl: z.string().url().max(2048).optional(),
  allowExternalSearch: z.boolean().default(false),
});

export async function searchSharedCatalogProduct(raw: unknown) {
  const input = sharedSearchInput.parse(raw);
  if (!process.env.OPENAI_API_KEY && !input.sourceUrl) throw new Error("openai_not_configured");
  const product: MatchableProduct = {
    name: input.product.title,
    // PDF-generated internal IDs are not manufacturer SKUs. Comparing them to
    // the site's SKU would reject the correct product (or select a wrong photo).
    supplierSku: /^(?:JD|JDR)[-_][A-Z0-9]+/i.test(input.product.sku) ? null : input.product.sku,
    barcode: input.product.barcode || null,
    brand: input.product.brand ? { name: input.product.brand } : null,
    supplier: null, category: null, productLineName: null,
    volumeValue: input.product.volumeValue || null,
    volumeUnit: input.product.volumeUnit || null,
  };
  let sourceUrl = input.sourceUrl || "";
  let stage: "official_unverified" | "external" | "provided" = sourceUrl ? "provided" : "external";
  let domain = "";
  if (!sourceUrl && product.brand) {
    const site = await findOfficialBrandSite({ product });
    if (site.domain) {
      domain = site.domain;
      const match = await findOfficialProductUrl({ product, allowedDomains: [domain] });
      if (match.found && match.url) {
        sourceUrl = match.url;
        stage = "official_unverified";
      }
    }
  }
  if (!sourceUrl && input.allowExternalSearch) {
    const match = await findExternalProductUrl({ product, officialDomainsTried: domain ? [domain] : [] });
    if (match.found && match.url) {
      sourceUrl = match.url;
      stage = "external";
    }
  }
  if (!sourceUrl) throw new Error("product_page_not_found");
  if (stage !== "official_unverified" && !validatedExternalProductUrl(sourceUrl))
    throw new Error("source_url_not_allowed");
  domain = new URL(sourceUrl).hostname.replace(/^www\./, "");
  const fetched = await safeFetchHtml(sourceUrl, [{ domain, allowSubdomains: true }]);
  const extracted = extractProductFromHtml({ buffer: fetched.buffer, finalUrl: fetched.finalUrl });
  const match = scoreProductMatch(product, extracted);
  if (match.confidence < 25 || match.evidence.sku === "mismatch" ||
      match.evidence.brand === "mismatch" || match.evidence.volume === "mismatch")
    throw new Error("product_match_not_confirmed");
  let copy = fallbackDescription(extracted);
  if (process.env.OPENAI_API_KEY) {
    try { copy = await generateProductDescription({ product, extracted, sourceUrl: fetched.finalUrl }); }
    catch { /* The extracted page remains available for manual review. */ }
  }
  const separated = separateProductSections(copy);
  return {
    sourceUrl: fetched.finalUrl, sourceType: stage, confidence: match.confidence,
    fields: {
      shortDescription: copy.shortDescription.slice(0, 280),
      description: separated.description.slice(0, 12_000),
      application: separated.application.slice(0, 4_000),
      ingredients: separated.ingredients.slice(0, 4_000),
    },
    images: extracted.images.filter(url => Boolean(validatedExternalProductUrl(url))).slice(0, 8),
    warnings: [...new Set([...match.warnings, ...copy.warnings,
      ...(stage === "official_unverified" ? ["unverified_official_site_manual_review_required"] : []),
      ...(stage === "external" ? ["external_source_manual_review_required"] : []),
    ])],
  };
}
