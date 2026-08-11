import {
  EnrichmentJobStatus,
  EnrichmentProposalStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { importProductImage } from "./productImages";

export type ProposalApplyMode = "ALL" | "DESCRIPTION" | "IMAGE";

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
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

  const finalApproval = input.mode === "ALL";
  const applyDescription = finalApproval || input.mode === "DESCRIPTION";
  const applyImage = finalApproval || input.mode === "IMAGE";

  if (finalApproval) {
    if (!Number.isInteger(input.stock) || Number(input.stock) < 0) {
      throw new Error("proposal_stock_required");
    }
  }

  if (applyDescription) {
    const description = composeDescription(proposal);
    if (!description) throw new Error("proposal_description_empty");

    await prisma.product.update({
      where: { id: proposal.productId },
      data: {
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

  if (finalApproval) {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: proposal.productId },
        data: { stock: Number(input.stock) },
      });

      await tx.productEnrichmentProposal.update({
        where: { id: proposal.id },
        data: {
          status: EnrichmentProposalStatus.APPLIED,
          appliedAt: new Date(),
        },
      });

      if (proposal.jobId) {
        await tx.enrichmentJob.update({
          where: { id: proposal.jobId },
          data: {
            status: EnrichmentJobStatus.APPLIED,
            finishedAt: new Date(),
            error: null,
          },
        });
      }
    });
  }

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
            description: true,
            stock: true,
            isPublished: true,
            enrichmentStatus: true,
          },
        },
        source: true,
        job: true,
      },
    }),
    importedImage,
    finalized: finalApproval,
  };
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
          isPublished: true,
          enrichmentStatus: true,
        },
      },
      source: true,
      job: true,
    },
  });
}
