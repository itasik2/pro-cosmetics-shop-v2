import {
  EnrichmentJobStatus,
  EnrichmentProposalStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeStoredVariants } from "@/lib/price-import/productVariants";
import { importProductImage } from "./productImages";

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

  const description = String(input.description || "").trim();
  const application = String(input.application || "").trim();
  const ingredients = String(input.ingredients || "").trim();

  if (description) sections.push(description);
  if (application) sections.push(`Способ применения\n${application}`);
  if (ingredients) sections.push(`Состав и активные компоненты\n${ingredients}`);

  return sections.join("\n\n").trim();
}

async function refreshProductEnrichmentStatus(productId: string) {
  const pending = await prisma.productEnrichmentProposal.count({
    where: {
      productId,
      status: EnrichmentProposalStatus.PENDING,
      confidence: { gt: 0 },
    },
  });

  await prisma.product.update({
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
}) {
  const proposal = await prisma.productEnrichmentProposal.findUnique({
    where: { id: input.proposalId },
    include: {
      product: {
        include: {
          supplier: { select: { id: true } },
        },
      },
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

  const finalize = input.mode === "ALL";
  const applyDescription = input.mode === "ALL" || input.mode === "DESCRIPTION";
  const applyImage = input.mode === "ALL" || input.mode === "IMAGE";
  const applyInventory = input.mode === "ALL" || input.mode === "IMAGE";

  if (applyDescription) {
    const description = composeDescription(proposal);
    if (!description) throw new Error("proposal_description_empty");
    if (finalize && !proposal.shortDescription?.trim()) {
      throw new Error("proposal_short_description_empty");
    }

    await prisma.product.update({
      where: { id: proposal.productId },
      data: {
        shortDescription: proposal.shortDescription?.trim() || null,
        description,
        descriptionSourceUrl: proposal.sourceUrl,
      },
    });
  }

  let importedImage = null;
  if (applyImage) {
    const images = stringArray(proposal.images);
    const selectedImage = String(input.imageUrl || images[0] || "").trim();

    if (!selectedImage) throw new Error("proposal_image_missing");
    if (!images.includes(selectedImage)) {
      throw new Error("proposal_image_not_allowed");
    }
    if (!proposal.product.supplier?.id) {
      throw new Error("product_supplier_required");
    }

    importedImage = await importProductImage({
      productId: proposal.productId,
      supplierId: proposal.product.supplier.id,
      sourceUrl: selectedImage,
      makePrimary: true,
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const variants = applyInventory
      ? normalizeStoredVariants(proposal.product.variants)
      : [];

    if (applyInventory && variants.length) {
      const stocks = input.variantStocks || {};
      const updatedVariants = variants.map((variant) => {
        const nextStock = stocks[variant.id];
        if (nextStock === undefined) return variant;
        if (!Number.isInteger(nextStock) || nextStock < 0) {
          throw new Error("variant_stock_invalid");
        }
        return { ...variant, stock: nextStock };
      });
      const totalStock = updatedVariants.reduce((sum, variant) => sum + variant.stock, 0);
      await tx.product.update({
        where: { id: proposal.productId },
        data: {
          variants: updatedVariants,
          stock: totalStock,
        },
      });
    } else if (applyInventory && input.stock !== undefined) {
      await tx.product.update({
        where: { id: proposal.productId },
        data: { stock: input.stock },
      });
    }

    const updatedProposal = await tx.productEnrichmentProposal.update({
      where: { id: proposal.id },
      data: finalize
        ? {
            status: EnrichmentProposalStatus.APPLIED,
            appliedAt: new Date(),
          }
        : {
            status: EnrichmentProposalStatus.PENDING,
            appliedAt: null,
          },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            image: true,
            shortDescription: true,
            description: true,
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

    if (proposal.jobId) {
      await tx.enrichmentJob.update({
        where: { id: proposal.jobId },
        data: finalize
          ? {
              status: EnrichmentJobStatus.APPLIED,
              finishedAt: new Date(),
              error: null,
            }
          : {
              status: EnrichmentJobStatus.REVIEW,
              finishedAt: null,
              error: null,
            },
      });
    }

    return updatedProposal;
  });

  await refreshProductEnrichmentStatus(proposal.productId);

  return {
    proposal: await prisma.productEnrichmentProposal.findUnique({
      where: { id: result.id },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            image: true,
            shortDescription: true,
            description: true,
            stock: true,
            variants: true,
            isPublished: true,
            enrichmentStatus: true,
          },
        },
        source: true,
        job: true,
      },
    }),
    importedImage,
  };
}

export async function finalizeProductEnrichmentText(input: {
  proposalId: string;
  appliedBy: "AUTOPILOT" | "ADMIN";
  evaluation?: {
    reasons: string[];
    checks: Record<string, unknown>;
  };
}) {
  const proposal = await prisma.productEnrichmentProposal.findUnique({
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

  const description = composeDescription(proposal);
  const shortDescription = String(proposal.shortDescription || "").trim();
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

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.productEnrichmentProposal.updateMany({
      where: {
        id: proposal.id,
        status: EnrichmentProposalStatus.PENDING,
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

  if (audit.appliedBy !== "AUTOPILOT") throw new Error("autopilot_audit_not_found");
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

export async function rejectProductEnrichmentProposal(proposalId: string) {
  const proposal = await prisma.productEnrichmentProposal.findUnique({
    where: { id: proposalId },
    select: {
      id: true,
      productId: true,
      jobId: true,
      status: true,
    },
  });

  if (!proposal) throw new Error("proposal_not_found");
  if (proposal.status !== EnrichmentProposalStatus.PENDING) {
    throw new Error("proposal_not_pending");
  }

  await prisma.$transaction(async (tx) => {
    await tx.productEnrichmentProposal.update({
      where: { id: proposal.id },
      data: { status: EnrichmentProposalStatus.REJECTED },
    });

    if (proposal.jobId) {
      await tx.enrichmentJob.update({
        where: { id: proposal.jobId },
        data: {
          status: EnrichmentJobStatus.CANCELED,
          finishedAt: new Date(),
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
}
