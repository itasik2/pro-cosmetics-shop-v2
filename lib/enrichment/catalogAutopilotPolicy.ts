export type CatalogAutopilotDecision =
  | "AUTO_APPLY"
  | "RETRY"
  | "REVIEW"
  | "DISCARD";

export type CatalogAutopilotConfig = {
  enabled: boolean;
  minConfidence: number;
  proposalBatch: number;
  discoveryBatch: number;
  monitorBatch: number;
};

export type CatalogAutopilotEvaluation = {
  decision: CatalogAutopilotDecision;
  reasons: string[];
  checks: {
    confidence: number;
    officialSource: boolean;
    sourceEnabled: boolean;
    sourceDomainAllowed: boolean;
    descriptionLength: number;
    shortDescriptionLength: number;
    benefitCount: number;
    hasAudienceSection: boolean;
    hasApplication: boolean;
    promotionalTextFound: boolean;
    retryCount: number;
  };
};

export type CatalogAutopilotProposalInput = {
  confidence: number;
  sourceType?: string | null;
  sourceEnabled?: boolean | null;
  sourceUrl?: string | null;
  sourceDomain?: string | null;
  allowSubdomains?: boolean | null;
  description?: string | null;
  shortDescription?: string | null;
  application?: string | null;
  warnings?: unknown;
  retryCount?: number;
};

const BLOCKING_WARNINGS = new Set([
  "openai_not_configured",
  "description_missing",
]);

const PROMOTIONAL_TEXT_PATTERN =
  /(?:^|[^\p{L}\p{N}])(?:купить|покупайте|заказ(?:ать|ы|ом|а|у|е|ывайте)?|цен(?:а|ы|е|у|ой|ам|ами)?|доставк[а-я]*|интернет[-\s]?магазин[а-я]*|магазин[а-я]*|продаж[а-я]*|скидк[а-я]*|оптом|розниц[а-я]*|в\s+наличии|казахстан(?:е|а|у)?|алмат(?:ы|е|а|у)?|астан(?:а|е|ы|у)?|нур[-\s]?султан(?:е|а|у)?)(?=$|[^\p{L}\p{N}])|от\s+производителя/iu;

function integerFromEnv(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function warningList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sourceMatchesDomain(input: CatalogAutopilotProposalInput) {
  const expected = String(input.sourceDomain || "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (!expected) return false;

  try {
    const url = new URL(String(input.sourceUrl || ""));
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.username || url.password || url.port) return false;
    const hostname = url.hostname.toLowerCase()
      .replace(/^www\./, "");
    return (
      hostname === expected ||
      (input.allowSubdomains !== false && hostname.endsWith(`.${expected}`))
    );
  } catch {
    return false;
  }
}

export function getCatalogAutopilotConfig(): CatalogAutopilotConfig {
  return {
    enabled: process.env.CATALOG_AUTOPILOT_ENABLED?.trim().toLowerCase() !== "false",
    minConfidence: integerFromEnv(
      process.env.CATALOG_AUTOPILOT_MIN_CONFIDENCE,
      90,
      90,
      100,
    ),
    proposalBatch: integerFromEnv(
      process.env.CATALOG_AUTOPILOT_PROPOSAL_BATCH,
      8,
      1,
      25,
    ),
    discoveryBatch: integerFromEnv(
      process.env.CATALOG_AUTOPILOT_DISCOVERY_BATCH,
      1,
      0,
      3,
    ),
    monitorBatch: integerFromEnv(
      process.env.CATALOG_AUTOPILOT_MONITOR_BATCH,
      4,
      0,
      8,
    ),
  };
}

export function evaluateCatalogAutopilotProposal(
  input: CatalogAutopilotProposalInput,
  config: Pick<CatalogAutopilotConfig, "enabled" | "minConfidence">,
): CatalogAutopilotEvaluation {
  const confidence = Math.min(100, Math.max(0, Math.trunc(input.confidence || 0)));
  const description = String(input.description || "").trim();
  const shortDescription = String(input.shortDescription || "").trim();
  const application = String(input.application || "").trim();
  const warnings = warningList(input.warnings);
  const blockingWarnings = warnings
    .filter(
      (warning) =>
        BLOCKING_WARNINGS.has(warning) ||
        warning.startsWith("description_generation_failed:"),
    )
    .map((warning) => `blocking_warning:${warning}`);
  const retryCount = Math.max(0, Math.trunc(input.retryCount || 0));
  const officialSource = String(input.sourceType || "").toUpperCase() === "OFFICIAL_SITE";
  const sourceEnabled = input.sourceEnabled !== false;
  const sourceDomainAllowed = sourceMatchesDomain(input);
  const benefitCount = description
    .split("\n")
    .filter((line) => /^\s*[•*-]\s+\S/u.test(line)).length;
  const hasAudienceSection = /(?:^|\n)\s*Для (?:какой кожи|каких задач)\s*(?:\n|:)/iu.test(
    description,
  );
  const promotionalTextFound =
    PROMOTIONAL_TEXT_PATTERN.test(description) ||
    PROMOTIONAL_TEXT_PATTERN.test(shortDescription);

  const checks: CatalogAutopilotEvaluation["checks"] = {
    confidence,
    officialSource,
    sourceEnabled,
    sourceDomainAllowed,
    descriptionLength: description.length,
    shortDescriptionLength: shortDescription.length,
    benefitCount,
    hasAudienceSection,
    hasApplication: application.length >= 20,
    promotionalTextFound,
    retryCount,
  };

  if (!config.enabled) {
    return { decision: "REVIEW", reasons: ["autopilot_disabled"], checks };
  }

  if (confidence === 0) {
    return { decision: "DISCARD", reasons: ["zero_match_discarded"], checks };
  }

  if (confidence < 70) {
    if (blockingWarnings.length) {
      return {
        decision: "REVIEW",
        reasons: ["low_match_manual_review_required", ...blockingWarnings],
        checks,
      };
    }
    return {
      decision: retryCount < 1 ? "RETRY" : "REVIEW",
      reasons: [
        retryCount < 1
          ? "low_match_retry_required"
          : "low_match_manual_review_required",
      ],
      checks,
    };
  }

  const reasons: string[] = [];
  if (confidence < config.minConfidence) reasons.push("confidence_below_auto_apply_threshold");
  if (!officialSource) reasons.push("official_source_required");
  if (!sourceEnabled) reasons.push("source_disabled");
  if (!sourceDomainAllowed) reasons.push("source_domain_mismatch");
  if (description.length < 500) reasons.push("description_too_short");
  if (description.length > 5_000) reasons.push("description_too_long");
  if (shortDescription.length < 80) reasons.push("short_description_too_short");
  if (shortDescription.length > 280) reasons.push("short_description_too_long");
  if (!hasAudienceSection) reasons.push("skin_or_task_section_missing");
  if (benefitCount < 3) reasons.push("benefits_missing");
  if (application.length < 20) reasons.push("application_missing");
  if (promotionalTextFound) reasons.push("promotional_text_found");

  reasons.push(...blockingWarnings);

  return {
    decision: reasons.length ? "REVIEW" : "AUTO_APPLY",
    reasons: [...new Set(reasons)],
    checks,
  };
}
