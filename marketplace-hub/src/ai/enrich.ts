import { z } from "zod";
import { discoverProductSource } from "./discovery.js";
import { extractProductFromHtml } from "./extract.js";
import { scoreProductMatch } from "./match.js";
import { safeFetchHtml, sourcePolicyForUrl } from "./network.js";
import { knownOfficialDomains } from "./official-sources.js";
import {
  fallbackProductCopy,
  findExternalProductUrl,
  findOfficialBrandSite,
  findOfficialProductUrl,
  generateProductCopy,
} from "./openai.js";
import { evaluateEnrichmentProposal } from "./policy.js";
import type { AllowedSourcePolicy, CatalogProductInput } from "./types.js";

export const enrichmentRequestSchema = z.object({
  product: z.object({
    sku: z.string().trim().min(1),
    skuIsInternal: z.boolean().optional(),
    title: z.string().trim().min(1),
    brand: z.string().trim().optional(),
    barcode: z.string().trim().optional(),
    categoryKey: z.string().trim().optional(),
    description: z.string().optional(),
    volumeValue: z.number().positive().optional(),
    volumeUnit: z.string().trim().optional(),
  }),
  sourceUrl: z.string().url().optional(),
  discoverIfMissing: z.boolean().default(true),
  allowExternalSearch: z.boolean().default(false),
  sources: z
    .array(
      z.object({
        domain: z.string().trim().min(1),
        allowSubdomains: z.boolean().default(true),
        sourceType: z
          .enum(["OFFICIAL_SITE", "DISTRIBUTOR", "DISCOVERED_WEB"])
          .optional(),
      }),
    )
    .default([]),
});

export type EnrichmentRequest = z.input<typeof enrichmentRequestSchema>;

function exactPolicy(url: string): AllowedSourcePolicy {
  const parsed = new URL(url);
  return {
    domain: parsed.hostname.toLowerCase(),
    allowSubdomains: false,
    sourceType: "DISCOVERED_WEB",
  };
}

export async function buildEnrichmentProposal(raw: EnrichmentRequest) {
  const input = enrichmentRequestSchema.parse(raw);
  const product = input.product as CatalogProductInput;
  const policies: AllowedSourcePolicy[] = [...input.sources];

  let sourceUrl = input.sourceUrl?.trim() || "";
  let search: {
    stage: "official" | "official_unverified" | "external";
    confidence: number;
    reason: string;
    officialFailure?: string;
  } | null = null;

  if (!sourceUrl && input.discoverIfMissing) {
    const officialDomains = policies
      .filter((policy) => policy.sourceType === "OFFICIAL_SITE")
      .map((policy) => policy.domain);

    const discovered = await discoverProductSource({
      hasOfficialSources: officialDomains.length > 0,
      allowExternalSearch: input.allowExternalSearch,
      official: () =>
        findOfficialProductUrl({ product, allowedDomains: officialDomains }),
      unconfiguredOfficial: product.brand?.trim() ? async () => {
        const known = knownOfficialDomains(product.brand);
        if (known.length) {
          const found = await findOfficialProductUrl({ product, allowedDomains: known });
          if (found.found && found.url) return {
            ...found, domain: new URL(found.url).hostname.replace(/^www\./, ""),
          };
        }
        const site = await findOfficialBrandSite({ product });
        if (!site.found || !site.domain) return { ...site, domain: null };
        const found = await findOfficialProductUrl({ product, allowedDomains: [site.domain] });
        return { ...found, domain: site.domain };
      } : undefined,
      external: () =>
        findExternalProductUrl({
          product,
          officialDomainsTried: officialDomains,
        }),
    });
    if (discovered) {
      sourceUrl = discovered.url;
      search = discovered.search;
      if (search.stage === "external") policies.push(exactPolicy(sourceUrl));
      if (search.stage === "official_unverified" && discovered.officialDomain) {
        policies.push({ domain: discovered.officialDomain, allowSubdomains: true,
          sourceType: "DISCOVERED_WEB" });
      }
    }
  }

  if (!sourceUrl) throw new Error("source_url_required");

  // An operator-supplied product URL is an explicit source selection. Constrain
  // fetching to its exact hostname; safeFetchHtml still rejects private IPs,
  // unsafe DNS results and redirects to other hosts.
  if (
    sourceUrl &&
    input.sourceUrl &&
    !sourcePolicyForUrl(policies, sourceUrl)
  ) {
    policies.push(exactPolicy(sourceUrl));
  }
  const initialPolicy = sourcePolicyForUrl(policies, sourceUrl);
  if (!initialPolicy) throw new Error("source_domain_not_allowed");

  const fetched = await safeFetchHtml(sourceUrl, policies);
  const finalPolicy = sourcePolicyForUrl(policies, fetched.finalUrl);
  if (!finalPolicy) throw new Error("source_domain_not_allowed_after_redirect");

  const extracted = extractProductFromHtml({
    buffer: fetched.buffer,
    finalUrl: fetched.finalUrl,
  });
  const match = scoreProductMatch(product, extracted);

  let copy = fallbackProductCopy(extracted);
  const generationWarnings: string[] = [];

  if (match.confidence > 0 && process.env.OPENAI_API_KEY) {
    try {
      copy = await generateProductCopy({
        product,
        extracted,
        sourceUrl: fetched.finalUrl,
      });
    } catch (error) {
      generationWarnings.push(
        `description_generation_failed:${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const warnings = [
    ...match.warnings,
    ...copy.warnings,
    ...generationWarnings,
    ...(search?.stage === "official_unverified"
      ? ["unverified_official_site_manual_review_required"] : []),
    ...(finalPolicy.sourceType !== "OFFICIAL_SITE"
      ? ["external_source_manual_review_required"]
      : []),
  ];

  const evaluation = evaluateEnrichmentProposal({
    confidence: match.confidence,
    sourceType: finalPolicy.sourceType,
    sourceDomainAllowed: true,
    copy,
    warnings,
  });

  return {
    product,
    source: {
      url: fetched.finalUrl,
      sourceType: finalPolicy.sourceType ?? "DISCOVERED_WEB",
      search,
      httpStatus: fetched.status,
      contentType: fetched.contentType,
    },
    match,
    extracted,
    draft: copy,
    imageCandidates: extracted.images.map((url) => ({
      url,
      status: "REVIEW_REQUIRED" as const,
    })),
    warnings: [...new Set(warnings)],
    evaluation,
  };
}
