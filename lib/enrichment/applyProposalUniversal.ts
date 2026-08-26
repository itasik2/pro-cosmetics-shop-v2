import {
  EnrichmentJobStatus,
  EnrichmentProposalStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeStoredVariants } from "@/lib/price-import/productVariants";
import {
  applyProductEnrichmentProposal,
  type ProposalApplyMode as LegacyProposalApplyMode,
} from "./applyProposal";

export type ProposalApplyMode = LegacyProposalApplyMode | "INVENTORY";

function composeDescription(input: {
  description: string | null;
  application: string | null;
}) {
  const sections: string[] = [];
  const description = String(input.description || "").trim();
  const application = String(input.application || "").trim();

  if (description) sections.push(description);
  if (application) sections.push(`Способ применения\n${application}`);

  return sections.join("\n\n").trim();
}

function validateInventory(input: {
  variants: ReturnType<typeof normalizeStoredVariants>;
  stock?: number;
  variantStocks?: Record<string, number>;
}) {
  if (input.variants.length) {
    const stocks = input.variantStocks || {};
    return {
      variants: input.variants.map((variant) => {
        const nextStock = stocks[variant.id];
        if (nextStock === undefined) return variant;
        if (!Number.isInteger(nextStock) || nextStock < 0) {
          throw new Error("variant_stock_invalid");
        }
        return { ...variant, stock: nextStock };
      }),
      stock: null as number | null,
    };
  }

  if (input.stock !== undefined && (!Number.isInteger(input.stock) || input.stock < 0)) {
    throw new Error("variant_stock_invalid");
  }

  return {
    variants: null as ReturnType<typeof normalizeStoredVariants> | null,
    stock: input.stock ?? null,
  };
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

async function applyWithoutReplacingImage(input: {
  proposalId: string;
  finalize: boolean;
  applyText: boolean;
  stock?: number;
  variantStocks?: Record<string, number>;
}) {
  const proposal = await prisma.productEnrichmentProposal.findUnique({
    where: { id: input.proposalId },
    include: {
      product: true,
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

  const description = input.applyText ? composeDescription(proposal) : "";
  if (input.applyText && !description) throw new Error("proposal_description_empty");
  if (input.finalize && !proposal.shortDescription?.trim()) {
    throw new Error("proposal_short_description_empty");
  }

  const storedVariants = normalizeStoredVariants(proposal.product.variants);
  const inventory = validateInventory({
    variants: storedVariants,
    stock: input.stock,
    variantStocks: input.variantStocks,
  });
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const productData: Record<string, unknown> = {};

    if (input.applyText) {
      productData.shortDescription = proposal.shortDescription?.trim() || null;
      productData.description = description;
      productData.descriptionSourceUrl = proposal.sourceUrl;
    }

    if (inventory.variants) {
      productData.variants = inventory.variants;
      productData.stock = inventory.variants.reduce(
        (sum, variant) => sum + variant.stock,
        0,
      );
    } else if (inventory.stock !== null) {
      productData.stock = inventory.stock;
    }

    if (Object.keys(productData).length) {
      await tx.product.update({
        where: { id: proposal.productId },
        data: productData,
      });
    }

    await tx.productEnrichmentProposal.update({
      where: { id: proposal.id },
      data: input.finalize
        ? {
            status: EnrichmentProposalStatus.APPLIED,
            appliedAt: now,
          }
        : {
            status: EnrichmentProposalStatus.PENDING,
            appliedAt: null,
          },
    });

    if (proposal.jobId) {
      await tx.enrichmentJob.update({
        where: { id: proposal.jobId },
        data: input.finalize
          ? {
              status: EnrichmentJobStatus.APPLIED,
              finishedAt: now,
              error: null,
            }
          : {
              status: EnrichmentJobStatus.REVIEW,
              finishedAt: null,
              error: null,
            },
      });
    }
  });

  await refreshProductEnrichmentStatus(proposal.productId);

  return {
    proposal: await prisma.productEnrichmentProposal.findUnique({
      where: { id: proposal.id },
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
    importedImage: null,
    imagePreserved: true,
  };
}

export async function applyProductEnrichmentProposalUniversal(input: {
  proposalId: string;
  mode: ProposalApplyMode;
  imageUrl?: string | null;
  stock?: number;
  variantStocks?: Record<string, number>;
}) {
  const selectedImage = String(input.imageUrl || "").trim();

  if (input.mode === "INVENTORY") {
    return applyWithoutReplacingImage({
      proposalId: input.proposalId,
      finalize: false,
      applyText: false,
      stock: input.stock,
      variantStocks: input.variantStocks,
    });
  }

  if (input.mode === "ALL" && !selectedImage) {
    return applyWithoutReplacingImage({
      proposalId: input.proposalId,
      finalize: true,
      applyText: true,
      stock: input.stock,
      variantStocks: input.variantStocks,
    });
  }

  return applyProductEnrichmentProposal({
    proposalId: input.proposalId,
    mode: input.mode as LegacyProposalApplyMode,
    imageUrl: selectedImage || null,
    stock: input.stock,
    variantStocks: input.variantStocks,
  });
}
