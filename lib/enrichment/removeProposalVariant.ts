import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeStoredVariants } from "@/lib/price-import/productVariants";
import { imageGroups, photoSku } from "./variantImages";
import { productForVariant } from "./variantPhotoSearch";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function removeProposalVariant(
  input: {
    productId: string;
    proposalId: string;
    variantId: string;
    sku: string;
  },
  database = prisma,
) {
  return database.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: input.productId },
    });
    if (!product) throw new Error("product_not_found");
    const proposal = await tx.productEnrichmentProposal.findUnique({
      where: { id: input.proposalId },
    });
    if (
      !proposal ||
      proposal.productId !== product.id ||
      proposal.status !== "PENDING"
    )
      throw new Error("proposal_not_pending");
    const variants = normalizeStoredVariants(product.variants);
    const removed = variants.find((variant) => variant.id === input.variantId);
    if (!removed || photoSku(removed.sku) !== photoSku(input.sku))
      throw new Error("variant_sku_changed");
    if (variants.length <= 1) throw new Error("last_variant_requires_reject");
    const remaining = variants.filter((variant) => variant.id !== removed.id);
    const primaryRemoved =
      photoSku(product.supplierSku) === photoSku(removed.sku);
    const nextPrimary = productForVariant(
      { ...product, brand: null, supplier: null },
      remaining[0],
    );
    const prices = remaining
      .map((variant) => variant.price)
      .filter((price) => price > 0);
    const written = await tx.product.updateMany({
      where: { id: product.id, updatedAt: product.updatedAt },
      data: {
        variants: remaining,
        stock: remaining.reduce((sum, variant) => sum + variant.stock, 0),
        price: prices.length ? Math.min(...prices) : product.price,
        ...(primaryRemoved
          ? {
              supplierSku: remaining[0].sku || null,
              sourceUrl: null,
              ...(remaining[0].image ? { image: remaining[0].image } : {}),
              volumeValue: nextPrimary.volumeValue,
              volumeUnit: nextPrimary.volumeUnit,
            }
          : {}),
      },
    });
    if (written.count !== 1) throw new Error("product_changed_refresh");
    const pending = await tx.productEnrichmentProposal.findMany({
      where: { productId: product.id, status: "PENDING" },
    });
    if (!pending.some((row) => row.id === proposal.id))
      throw new Error("proposal_not_pending");
    for (const row of pending) {
      const facts = object(row.facts);
      const history = Array.isArray(facts.removedVariants)
        ? facts.removedVariants
        : [];
      const excluded = Array.isArray(facts.removedVariantSkus)
        ? facts.removedVariantSkus.filter((item) => typeof item === "string")
        : [];
      const claimed = await tx.productEnrichmentProposal.updateMany({
        where: { id: row.id, status: "PENDING", updatedAt: row.updatedAt },
        data: {
          ...(primaryRemoved ? { images: [] } : {}),
          facts: {
            ...facts,
            variantImageCandidates: imageGroups(
              facts.variantImageCandidates,
            ).filter((group) => group.variantId !== removed.id),
            productImageCandidates: primaryRemoved
              ? []
              : imageGroups(facts.productImageCandidates),
            removedVariantSkus: [
              ...new Set([...excluded, photoSku(removed.sku)].filter(Boolean)),
            ],
            removedVariants: [
              ...history,
              { ...removed, removedAt: new Date().toISOString() },
            ],
            manualVariantReviewRequired: true,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      if (claimed.count !== 1) throw new Error("proposal_changed_refresh");
    }
    return { variants: remaining, removedVariantId: removed.id };
  });
}
