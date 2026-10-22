import {
  EnrichmentJobStatus,
  EnrichmentProposalStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { customerProductCopy } from "../productCopy";
import { applyProductEnrichmentProposalUniversal } from "./applyProposalUniversal";
import type { VariantImageSelection } from "./variantImages";
import { hasManualVariantChanges } from "./removedVariants";
import {
  hasManualProposalText,
  manuallyEditedProductName,
} from "./proposalText";

export type ProposalApplyMode = "ALL" | "DESCRIPTION" | "IMAGE";

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function composeDescription(input: {
  description: string | null;
  application: string | null;
  ingredients: string | null;
}) {
  const sections: string[] = [];

  const description = customerProductCopy(input.description);
  const application = customerProductCopy(input.application);
  const ingredients = customerProductCopy(input.ingredients);

  if (description) sections.push(description);
  if (application) sections.push(`Способ применения\n${application}`);
  if (ingredients)
    sections.push(`Состав и активные компоненты\n${ingredients}`);

  return sections.join("\n\n").trim();
}

async function refreshProductEnrichmentStatus(
  productId: string,
  database = prisma,
) {
  const pending = await database.productEnrichmentProposal.count({
    where: {
      productId,
      status: EnrichmentProposalStatus.PENDING,
      confidence: { gt: 0 },
    },
  });

  await database.product.update({
    where: { id: productId },
    data: { enrichmentStatus: pending > 0 ? "REVIEW" : "READY" },
  });
}

export async function applyProductEnrichmentProposal(input: {
  proposalId: string;
  mode: ProposalApplyMode;
  imageUrl?: string | null;
  stock?: number;
  variantStocks?: Record<string, number>;
  variantImages?: VariantImageSelection[];
}) {
  return applyProductEnrichmentProposalUniversal(input);
}

export async function finalizeProductEnrichmentText(
  input: {
    proposalId: string;
    appliedBy: "AUTOPILOT" | "ADMIN";
    evaluation?: {
      reasons: string[];
      checks: Record<string, unknown>;
    };
  },
  database = prisma,
) {
  const proposal = await database.productEnrichmentProposal.findUnique({
    where: { id: input.proposalId },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          shortDescription: true,
          description: true,
          descriptionSourceUrl: true,
          image: true,
          price: true,
          stock: true,
          isPublished: true,
          enrichmentStatus: true,
        },
      },
      source: true,
      job: true,
    },
  });

  if (!proposal) throw new Error("proposal_not_found");
  if (proposal.status !== EnrichmentProposalStatus.PENDING) {
    throw new Error("proposal_not_pending");
  }
  if (proposal.confidence === 0) {
    throw new Error("proposal_match_confidence_zero");
  }

  if (input.appliedBy === "AUTOPILOT" && hasManualProposalText(proposal.facts))
    throw new Error("manual_text_review_required");
  if (
    input.appliedBy === "AUTOPILOT" &&
    hasManualVariantChanges(proposal.facts)
  )
    throw new Error("manual_variant_review_required");
  const editedName = manuallyEditedProductName(proposal);

  const description = composeDescription(proposal);
  const shortDescription = customerProductCopy(proposal.shortDescription);
  if (!description) throw new Error("proposal_description_empty");
  if (!shortDescription) throw new Error("proposal_short_description_empty");

  const now = new Date();
  const facts = jsonObject(proposal.facts);
  const audit = {
    version: 1,
    decision:
      input.appliedBy === "AUTOPILOT"
        ? "AUTO_APPLIED_TEXT_ONLY"
        : "ADMIN_APPLIED_TEXT_ONLY",
    appliedBy: input.appliedBy,
    evaluatedAt: now.toISOString(),
    appliedAt: now.toISOString(),
    reasons: input.evaluation?.reasons || [],
    checks: input.evaluation?.checks || {},
    previous: {
      shortDescription: proposal.product.shortDescription,
      description: proposal.product.description,
      descriptionSourceUrl: proposal.product.descriptionSourceUrl,
      image: proposal.product.image,
      price: proposal.product.price,
      stock: proposal.product.stock,
      isPublished: proposal.product.isPublished,
    },
    applied: {
      shortDescription,
      description,
      descriptionSourceUrl: proposal.sourceUrl,
      image: proposal.product.image,
    },
  };

  await database.$transaction(async (tx) => {
    const claimed = await tx.productEnrichmentProposal.updateMany({
      where: {
        id: proposal.id,
        status: EnrichmentProposalStatus.PENDING,
        updatedAt: proposal.updatedAt,
      },
      data: {
        status: EnrichmentProposalStatus.APPLIED,
        appliedAt: now,
        facts: {
          ...facts,
          catalogAutopilot: audit,
        } as Prisma.InputJsonValue,
      },
    });

    if (claimed.count !== 1) throw new Error("proposal_not_pending");

    await tx.product.update({
      where: { id: proposal.productId },
      data: {
        ...(editedName ? { name: editedName } : {}),
        shortDescription,
        description,
        descriptionSourceUrl: proposal.sourceUrl,
      },
    });

    if (proposal.jobId) {
      await tx.enrichmentJob.update({
        where: { id: proposal.jobId },
        data: {
          status: EnrichmentJobStatus.APPLIED,
          finishedAt: now,
          error: null,
        },
      });
    }
  });

  await refreshProductEnrichmentStatus(proposal.productId, database);

  return database.productEnrichmentProposal.findUnique({
    where: { id: proposal.id },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          shortDescription: true,
          description: true,
          image: true,
          price: true,
          stock: true,
          isPublished: true,
          enrichmentStatus: true,
        },
      },
      source: true,
      job: true,
    },
  });
}

export async function rollbackAutopilotDescription(proposalId: string) {
  const proposal = await prisma.productEnrichmentProposal.findUnique({
    where: { id: proposalId },
    include: {
      product: {
        select: {
          id: true,
          shortDescription: true,
          description: true,
          descriptionSourceUrl: true,
          image: true,
        },
      },
    },
  });

  if (!proposal) throw new Error("proposal_not_found");
  if (proposal.status !== EnrichmentProposalStatus.APPLIED) {
    throw new Error("proposal_not_applied");
  }

  const facts = jsonObject(proposal.facts);
  const audit = jsonObject(facts.catalogAutopilot);
  const previous = jsonObject(audit.previous);
  const applied = jsonObject(audit.applied);

  if (audit.appliedBy !== "AUTOPILOT")
    throw new Error("autopilot_audit_not_found");
  if (audit.rolledBackAt) throw new Error("autopilot_already_rolled_back");

  const currentMatchesApplied =
    proposal.product.shortDescription === (applied.shortDescription ?? null) &&
    proposal.product.description === applied.description &&
    proposal.product.descriptionSourceUrl ===
      (applied.descriptionSourceUrl ?? null);

  if (!currentMatchesApplied) {
    throw new Error("product_changed_after_autopilot");
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.productEnrichmentProposal.updateMany({
      where: {
        id: proposal.id,
        status: EnrichmentProposalStatus.APPLIED,
      },
      data: {
        status: EnrichmentProposalStatus.REJECTED,
        facts: {
          ...facts,
          catalogAutopilot: {
            ...audit,
            rolledBackAt: now.toISOString(),
          },
        } as Prisma.InputJsonValue,
      },
    });

    if (claimed.count !== 1) throw new Error("proposal_not_applied");

    await tx.product.update({
      where: { id: proposal.productId },
      data: {
        shortDescription:
          typeof previous.shortDescription === "string"
            ? previous.shortDescription
            : null,
        description: String(previous.description || ""),
        descriptionSourceUrl:
          typeof previous.descriptionSourceUrl === "string"
            ? previous.descriptionSourceUrl
            : null,
      },
    });

    if (proposal.jobId) {
      await tx.enrichmentJob.update({
        where: { id: proposal.jobId },
        data: {
          status: EnrichmentJobStatus.CANCELED,
          finishedAt: now,
          error: "autopilot_rolled_back",
        },
      });
    }
  });

  await refreshProductEnrichmentStatus(proposal.productId);

  return prisma.productEnrichmentProposal.findUnique({
    where: { id: proposal.id },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          shortDescription: true,
          description: true,
          image: true,
          enrichmentStatus: true,
        },
      },
    },
  });
}

export async function rejectProductEnrichmentProposal(
  proposalId: string,
  database = prisma,
  options: { automatic?: boolean } = {},
) {
  return database.$transaction(async (tx) => {
    const proposal = await tx.productEnrichmentProposal.findUnique({
      where: { id: proposalId },
      select: {
        id: true,
        productId: true,
        jobId: true,
        status: true,
        facts: true,
        updatedAt: true,
      },
    });

    if (!proposal) throw new Error("proposal_not_found");
    if (options.automatic && hasManualProposalText(proposal.facts))
      throw new Error("manual_text_review_required");
    if (
      proposal.status !== EnrichmentProposalStatus.PENDING &&
      proposal.status !== EnrichmentProposalStatus.REJECTED
    ) {
      throw new Error("proposal_not_pending");
    }

    if (proposal.status === EnrichmentProposalStatus.PENDING) {
      const claimed = await tx.productEnrichmentProposal.updateMany({
        where: {
          id: proposal.id,
          status: EnrichmentProposalStatus.PENDING,
          updatedAt: proposal.updatedAt,
        },
        data: { status: EnrichmentProposalStatus.REJECTED },
      });
      if (claimed.count !== 1) throw new Error("proposal_changed_refresh");

      if (proposal.jobId) {
        await tx.enrichmentJob.update({
          where: { id: proposal.jobId },
          data: {
            status: EnrichmentJobStatus.CANCELED,
            finishedAt: new Date(),
          },
        });
      }
    }

    const pending = await tx.productEnrichmentProposal.count({
      where: {
        productId: proposal.productId,
        status: EnrichmentProposalStatus.PENDING,
        confidence: { gt: 0 },
      },
    });
    await tx.product.update({
      where: { id: proposal.productId },
      data: { enrichmentStatus: pending > 0 ? "REVIEW" : "READY" },
    });

    return tx.productEnrichmentProposal.findUnique({
      where: { id: proposal.id },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            image: true,
            stock: true,
            variants: true,
            isPublished: true,
            enrichmentStatus: true,
          },
        },
        source: true,
        job: true,
      },
    });
  });
}
