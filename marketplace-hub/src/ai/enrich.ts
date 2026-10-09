import { z } from "zod";
import { extractProductFromHtml } from "./extract.js";
import { scoreProductMatch } from "./match.js";
import {
  safeFetchHtml,
  sourcePolicyForUrl,
} from "./network.js";
import {
  fallbackProductCopy,
  findExternalProductUrl,
  findOfficialProductUrl,
  generateProductCopy,
} from "./openai.js";
import { evaluateEnrichmentProposal } from "./policy.js";
import type {
  AllowedSourcePolicy,
  CatalogProductInput,
} from "./types.js";

export const enrichmentRequestSchema = z.object({
  product: z.object({
    sku: z.string().trim().min(1),
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
  let search:
    | {
        stage: "official" | "external";
        confidence: number;
        reason: string;
      }
    | null = null;

  if (!sourceUrl && input.discoverIfMissing) {
    const officialDomains = policies
      .filter((policy) => policy.sourceType === "OFFICIAL_SITE")
      .map((policy) => policy.domain);

    if (officialDomains.length) {
      const official = await findOfficialProductUrl({
        product,
        allowedDomains: officialDomains,
      });

      if (official.found && official.url) {
        sourceUrl = official.url;
        search = {
          stage: "official",
          confidence: official.confidence,
          reason: official.reason,
        };
      }
    }

    if (!sourceUrl && input.allowExternalSearch) {
      const external = await findExternalProductUrl({
        product,
        officialDomainsTried: officialDomains,
      });

      if (external.found && external.url) {
        sourceUrl = external.url;
        policies.push(exactPolicy(sourceUrl));
        search = {
          stage: "external",
          confidence: external.confidence,
          reason: external.reason,
        };
      }
    }
  }

  if (!sourceUrl) throw new Error("source_url_required");

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
