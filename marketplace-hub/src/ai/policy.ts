import type { GeneratedProductCopy } from "./types.js";

export type EnrichmentDecision =
  | "AUTO_APPLY_TEXT"
  | "REVIEW"
  | "DISCARD";

export function evaluateEnrichmentProposal(input: {
  confidence: number;
  sourceType?: string;
  sourceDomainAllowed: boolean;
  copy: GeneratedProductCopy;
  warnings: string[];
}) {
  const confidence = Math.max(0, Math.min(100, Math.trunc(input.confidence)));
  const official = input.sourceType === "OFFICIAL_SITE";
  const descriptionLength = input.copy.description.trim().length;
  const shortLength = input.copy.shortDescription.trim().length;
  const promotional =
    /\b(?:купить|заказать|скидк|доставк|цена|в наличии)\b/iu.test(
      `${input.copy.description} ${input.copy.shortDescription}`,
    );

  const checks = {
    confidence,
    officialSource: official,
    sourceDomainAllowed: input.sourceDomainAllowed,
    descriptionLength,
    shortDescriptionLength: shortLength,
    promotionalTextFound: promotional,
  };

  if (confidence === 0) {
    return { decision: "DISCARD" as const, reasons: ["zero_match"], checks };
  }

  const reasons: string[] = [];
  if (confidence < 90) reasons.push("confidence_below_auto_apply_threshold");
  if (!official) reasons.push("official_source_required");
  if (!input.sourceDomainAllowed) reasons.push("source_domain_mismatch");
  if (descriptionLength < 300) reasons.push("description_too_short");
  if (shortLength < 60) reasons.push("short_description_too_short");
  if (promotional) reasons.push("promotional_text_found");
  if (input.warnings.some((warning) => warning === "description_missing")) {
    reasons.push("description_missing");
  }

  return {
    decision: reasons.length ? ("REVIEW" as const) : ("AUTO_APPLY_TEXT" as const),
    reasons: [...new Set(reasons)],
    checks,
  };
}
