import {
  EnrichmentJobStatus,
  EnrichmentProposalStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  finalizeProductEnrichmentText,
  rejectProductEnrichmentProposal,
} from "./applyProposal";
import {
  evaluateCatalogAutopilotProposal,
  getCatalogAutopilotConfig,
  type CatalogAutopilotConfig,
  type CatalogAutopilotEvaluation,
} from "./catalogAutopilotPolicy";
import { monitorStaleProductSources } from "./monitorSources";
import { runProductEnrichment } from "./runProductEnrichment";

type ProposalResultStatus =
  | "APPLIED"
  | "REVIEW"
  | "RETRY_FAILED"
  | "DISCARDED"
  | "SKIPPED"
  | "FAILED";

export type CatalogAutopilotProposalResult = {
  proposalId: string;
  productId?: string;
  status: ProposalResultStatus;
  reasons: string[];
  replacementProposalId?: string;
  usedNetwork?: boolean;
};

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function messageOf(error: unknown) {
  return String(
    error && typeof error === "object" && "message" in error
      ? (error as { message?: unknown }).message
      : error || "catalog_autopilot_failed",
  ).slice(0, 1000);
}

function recoverableDiscoveryFailure(value: string | null | undefined) {
  const message = String(value || "");
  return (
    [
      "source_timeout",
      "source_dns_not_found",
      "source_redirect_without_location",
      "source_too_many_redirects",
      "source_fetch_failed",
      "openai_timeout",
      "openai_empty_output",
      "openai_invalid_json",
    ].includes(message) ||
    message.startsWith("source_fetch_failed:") ||
    /^source_http_(?:429|5\d\d)$/.test(message) ||
    /^openai_http_(?:429|5\d\d):/.test(message)
  );
}

function retryCountFromFacts(value: unknown) {
  const facts = jsonObject(value);
  const retry = jsonObject(facts.autopilotRetry);
  return Math.max(0, Math.trunc(Number(retry.count) || 0));
}

async function recordEvaluation(
  proposalId: string,
  factsValue: unknown,
  warningsValue: unknown,
  evaluation: CatalogAutopilotEvaluation,
) {
  const facts = jsonObject(factsValue);
  const warnings = stringArray(warningsValue);
  const evaluationWarnings = evaluation.reasons.map(
    (reason) => `catalog_autopilot:${reason}`,
  );

  await prisma.productEnrichmentProposal.updateMany({
    where: {
      id: proposalId,
      status: EnrichmentProposalStatus.PENDING,
    },
    data: {
      facts: {
        ...facts,
        catalogAutopilotEvaluation: {
          decision: evaluation.decision,
          reasons: evaluation.reasons,
          checks: evaluation.checks,
          evaluatedAt: new Date().toISOString(),
        },
      } as Prisma.InputJsonValue,
      warnings: [...new Set([...warnings, ...evaluationWarnings])] as Prisma.InputJsonValue,
    },
  });
}

export async function processCatalogAutopilotProposal(
  proposalId: string,
  config: CatalogAutopilotConfig = getCatalogAutopilotConfig(),
): Promise<CatalogAutopilotProposalResult> {
  const proposal = await prisma.productEnrichmentProposal.findUnique({
    where: { id: proposalId },
    include: {
      product: {
        select: {
          id: true,
          sourceUrl: true,
        },
      },
      source: {
        include: {
          supplierSource: {
            select: {
              sourceType: true,
              isEnabled: true,
              domain: true,
              allowSubdomains: true,
            },
          },
        },
      },
    },
  });

  if (!proposal || proposal.status !== EnrichmentProposalStatus.PENDING) {
    return {
      proposalId,
      productId: proposal?.productId,
      status: "SKIPPED",
      reasons: [proposal ? "proposal_not_pending" : "proposal_not_found"],
    };
  }

  const retryCount = retryCountFromFacts(proposal.facts);
  const evaluation = evaluateCatalogAutopilotProposal(
    {
      confidence: proposal.confidence,
      sourceType:
        proposal.source?.sourceType ||
        proposal.source?.supplierSource?.sourceType,
      sourceEnabled: proposal.source?.supplierSource?.isEnabled ?? false,
      sourceUrl: proposal.sourceUrl,
      sourceDomain: proposal.source?.supplierSource?.domain,
      allowSubdomains: proposal.source?.supplierSource?.allowSubdomains,
      description: proposal.description,
      shortDescription: proposal.shortDescription,
      application: proposal.application,
      warnings: proposal.warnings,
      retryCount,
    },
    config,
  );

  if (evaluation.decision === "AUTO_APPLY") {
    try {
      await finalizeProductEnrichmentText({
        proposalId: proposal.id,
        appliedBy: "AUTOPILOT",
        evaluation: {
          reasons: evaluation.reasons,
          checks: { ...evaluation.checks },
        },
      });
      return {
        proposalId: proposal.id,
        productId: proposal.productId,
        status: "APPLIED",
        reasons: [],
      };
    } catch (error) {
      return {
        proposalId: proposal.id,
        productId: proposal.productId,
        status: "FAILED",
        reasons: [messageOf(error)],
      };
    }
  }

  await recordEvaluation(
    proposal.id,
    proposal.facts,
    proposal.warnings,
    evaluation,
  );

  if (evaluation.decision === "DISCARD") {
    await rejectProductEnrichmentProposal(proposal.id);
    return {
      proposalId: proposal.id,
      productId: proposal.productId,
      status: "DISCARDED",
      reasons: evaluation.reasons,
    };
  }

  if (evaluation.decision !== "RETRY") {
    return {
      proposalId: proposal.id,
      productId: proposal.productId,
      status: "REVIEW",
      reasons: evaluation.reasons,
    };
  }

  await rejectProductEnrichmentProposal(proposal.id);
  if (proposal.product.sourceUrl === proposal.sourceUrl) {
    await prisma.product.update({
      where: { id: proposal.productId },
      data: { sourceUrl: null, enrichmentStatus: "PENDING" },
    });
  }

  try {
    const replacement = await runProductEnrichment({
      productId: proposal.productId,
      discoverIfMissing: true,
      excludedSourceUrls: [proposal.sourceUrl],
      autopilotRetryOf: proposal.id,
      autopilotRetryCount: retryCount + 1,
    });

    if (!replacement) {
      return {
        proposalId: proposal.id,
        productId: proposal.productId,
        status: "RETRY_FAILED",
        reasons: ["replacement_proposal_not_created"],
        usedNetwork: true,
      };
    }

    const replacementResult = await processCatalogAutopilotProposal(
      replacement.id,
      config,
    );
    return {
      proposalId: proposal.id,
      productId: proposal.productId,
      status: replacementResult.status,
      reasons: replacementResult.reasons,
      replacementProposalId: replacement.id,
      usedNetwork: true,
    };
  } catch (error) {
    return {
      proposalId: proposal.id,
      productId: proposal.productId,
      status: "RETRY_FAILED",
      reasons: [messageOf(error)],
      usedNetwork: true,
    };
  }
}

export async function runCatalogAutopilot() {
  const config = getCatalogAutopilotConfig();
  const startedAt = new Date();

  if (!config.enabled) {
    return {
      enabled: false,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      proposalResults: [] as CatalogAutopilotProposalResult[],
      discoveries: [],
      monitor: null,
    };
  }

  const proposalResults: CatalogAutopilotProposalResult[] = [];
  const zeroMatchProposals = await prisma.productEnrichmentProposal.findMany({
    where: {
      status: EnrichmentProposalStatus.PENDING,
      confidence: 0,
    },
    orderBy: { createdAt: "asc" },
    take: 25,
    select: { id: true },
  });
  for (const proposal of zeroMatchProposals) {
    proposalResults.push(
      await processCatalogAutopilotProposal(proposal.id, config),
    );
  }

  const pending = await prisma.productEnrichmentProposal.findMany({
    where: {
      status: EnrichmentProposalStatus.PENDING,
      confidence: { gt: 0 },
    },
    orderBy: { updatedAt: "asc" },
    take: config.proposalBatch,
    select: { id: true },
  });

  let usedNetwork = false;
  for (const proposal of pending) {
    const result = await processCatalogAutopilotProposal(proposal.id, config);
    proposalResults.push(result);
    usedNetwork ||= Boolean(result.usedNetwork);
    if (usedNetwork) break;
  }

  const discoveries: Array<{
    productId: string;
    status: "CREATED" | "FAILED";
    proposalId?: string;
    reason?: string;
  }> = [];

  if (!usedNetwork && config.discoveryBatch > 0) {
    const productCandidates = await prisma.product.findMany({
      where: {
        supplierId: { not: null },
        enrichmentStatus: { in: ["PENDING", "FAILED"] },
        enrichmentProposals: {
          none: {
            status: EnrichmentProposalStatus.PENDING,
            confidence: { gt: 0 },
          },
        },
        enrichmentJobs: {
          none: {
            status: {
              in: [EnrichmentJobStatus.PENDING, EnrichmentJobStatus.RUNNING],
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: Math.max(10, config.discoveryBatch * 10),
      select: {
        id: true,
        enrichmentStatus: true,
        enrichmentJobs: {
          orderBy: { createdAt: "desc" },
          take: 3,
          select: { status: true, error: true },
        },
      },
    });

    const products = productCandidates
      .filter((product) => {
        if (product.enrichmentStatus === "PENDING") return true;
        const latest = product.enrichmentJobs[0];
        if (!latest || !recoverableDiscoveryFailure(latest.error)) return false;
        let consecutiveFailures = 0;
        for (const job of product.enrichmentJobs) {
          if (job.status !== EnrichmentJobStatus.FAILED) break;
          consecutiveFailures += 1;
        }
        return consecutiveFailures < 3;
      })
      .slice(0, config.discoveryBatch);

    for (const product of products) {
      usedNetwork = true;
      try {
        const proposal = await runProductEnrichment({
          productId: product.id,
          discoverIfMissing: true,
        });
        if (!proposal) throw new Error("proposal_not_created");
        discoveries.push({
          productId: product.id,
          proposalId: proposal.id,
          status: "CREATED",
        });
        proposalResults.push(
          await processCatalogAutopilotProposal(proposal.id, config),
        );
      } catch (error) {
        discoveries.push({
          productId: product.id,
          status: "FAILED",
          reason: messageOf(error),
        });
      }
    }
  }

  let monitor: Awaited<ReturnType<typeof monitorStaleProductSources>> | null = null;
  if (!usedNetwork && config.monitorBatch > 0) {
    monitor = await monitorStaleProductSources({
      limit: config.monitorBatch,
      stopAfterChange: true,
      staleHours: Math.max(
        1,
        Math.trunc(Number(process.env.ENRICHMENT_MONITOR_STALE_HOURS) || 24 * 7),
      ),
    });

    for (const result of monitor.results) {
      if (result.proposalId) {
        proposalResults.push(
          await processCatalogAutopilotProposal(result.proposalId, config),
        );
      }
    }
  }

  return {
    enabled: true,
    config,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    proposalResults,
    discoveries,
    monitor,
    summary: {
      applied: proposalResults.filter((result) => result.status === "APPLIED").length,
      review: proposalResults.filter((result) => result.status === "REVIEW").length,
      retried: proposalResults.filter((result) => result.replacementProposalId).length,
      discarded: proposalResults.filter((result) => result.status === "DISCARDED").length,
      failed: proposalResults.filter((result) =>
        ["FAILED", "RETRY_FAILED"].includes(result.status),
      ).length,
      discovered: discoveries.filter((result) => result.status === "CREATED").length,
    },
  };
}
