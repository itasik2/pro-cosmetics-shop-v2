import {
  EnrichmentJobStatus,
  EnrichmentProposalStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeStoredVariants } from "@/lib/price-import/productVariants";
import { importProductImage } from "./productImages";
import {
  hasManualProposalText,
  manuallyEditedProductName,
} from "./proposalText";
import { hasManualVariantChanges } from "./removedVariants";
import { primarySkuPhotoCandidates } from "./automaticPhotos";
import {
  latestPriceListImageForProduct,
  priceListImagesBySku,
  priceVariantGroups,
} from "./priceListImages";
import {
  assignVariantImages,
  imageGroups,
  mergeImageGroups,
  validateVariantImages,
  type VariantImageSelection,
} from "./variantImages";

export type ProposalApplyMode = "ALL" | "DESCRIPTION" | "IMAGE" | "INVENTORY";
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function descriptionOf(proposal: {
  description: string | null;
  application: string | null;
  ingredients: string | null;
}) {
  return [
    proposal.description?.trim(),
    proposal.application?.trim()
      ? "Способ применения\n" + proposal.application.trim()
      : "",
    proposal.ingredients?.trim()
      ? "Состав и активные компоненты\n" + proposal.ingredients.trim()
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
export async function applyProductEnrichmentProposalUniversal(
  input: {
    proposalId: string;
    mode: ProposalApplyMode;
    imageUrl?: string | null;
    stock?: number;
    variantStocks?: Record<string, number>;
    variantImages?: VariantImageSelection[];
    automatic?: boolean;
  },
  dependencies: {
    database?: typeof prisma;
    importImage?: typeof importProductImage;
    loadPriceImages?: typeof priceListImagesBySku;
    loadCommonPriceImage?: typeof latestPriceListImageForProduct;
  } = {},
) {
  const database = dependencies.database || prisma;
  const importImage = dependencies.importImage || importProductImage;
  const loadPriceImages = dependencies.loadPriceImages || priceListImagesBySku;
  const loadCommonPriceImage =
    dependencies.loadCommonPriceImage || latestPriceListImageForProduct;
  const deadlineAt = Date.now() + 270_000;
  const proposal = await database.productEnrichmentProposal.findUnique({
    where: { id: input.proposalId },
    include: { product: true, job: true },
  });
  if (!proposal) throw new Error("proposal_not_found");
  if (proposal.status !== EnrichmentProposalStatus.PENDING)
    throw new Error("proposal_not_pending");
  if (input.automatic && hasManualProposalText(proposal.facts))
    throw new Error("manual_text_review_required");
  if (input.automatic && hasManualVariantChanges(proposal.facts))
    throw new Error("manual_variant_review_required");
  if (proposal.confidence === 0)
    throw new Error("proposal_match_confidence_zero");
  const finalize = input.mode === "ALL";
  const applyText = finalize || input.mode === "DESCRIPTION";
  const applyPhotos = finalize || input.mode === "IMAGE";
  const applyInventory = input.mode !== "DESCRIPTION";
  const description = applyText ? descriptionOf(proposal) : "";
  if (applyText && !description) throw new Error("proposal_description_empty");
  if (finalize && !proposal.shortDescription?.trim())
    throw new Error("proposal_short_description_empty");
  const selections = applyPhotos ? input.variantImages || [] : [];
  const variants = normalizeStoredVariants(proposal.product.variants);
  const facts = object(proposal.facts);
  const editedName = applyText ? manuallyEditedProductName(proposal) : null;
  const priceImages = selections.length
    ? await loadPriceImages([proposal.productId])
    : new Map();
  const groups = mergeImageGroups(
    imageGroups(facts.variantImageCandidates),
    priceVariantGroups(proposal.productId, variants, priceImages),
  );
  validateVariantImages(variants, selections, groups);
  const commonUrl = applyPhotos ? String(input.imageUrl || "").trim() : "";
  // A verified photo for the current primary SKU can also be its common photo.
  const commonFromPrimarySku = primarySkuPhotoCandidates(
    {
      id: proposal.productId,
      supplierSku: proposal.product.supplierSku,
      variants,
    },
    facts,
  ).some((candidate) => candidate.url === commonUrl);
  if (input.mode === "IMAGE" && !commonUrl && !selections.length)
    throw new Error("proposal_image_missing");
  if (
    commonUrl &&
    !commonFromPrimarySku &&
    !(Array.isArray(proposal.images) && proposal.images.includes(commonUrl))
  ) {
    const priceImage = await loadCommonPriceImage(proposal.productId);
    if (priceImage?.url !== commonUrl)
      throw new Error("proposal_image_not_allowed");
  }
  if (
    (commonUrl || selections.some((selection) => selection.imageUrl)) &&
    !proposal.product.supplierId
  )
    throw new Error("product_supplier_required");
  for (const value of [
    input.stock,
    ...Object.values(input.variantStocks || {}),
  ]) {
    if (
      value !== undefined &&
      (!Number.isInteger(value) || value < 0 || value > 1_000_000)
    )
      throw new Error("variant_stock_invalid");
  }
  // Uploads create reusable media only. Product/variant assignments happen atomically below.
  const importedImage = commonUrl
    ? await importImage({
        productId: proposal.productId,
        proposalId: proposal.id,
        supplierId: proposal.product.supplierId!,
        sourceUrl: commonUrl,
        makePrimary: false,
      })
    : null;
  const imported = new Map<string, string>();
  if (commonUrl && importedImage) imported.set(commonUrl, importedImage.url);
  const urls = [
    ...new Set(
      selections.flatMap((selection) =>
        selection.imageUrl ? [selection.imageUrl] : [],
      ),
    ),
  ].filter((url) => !imported.has(url));
  let cursor = 0;
  async function upload() {
    while (cursor < urls.length) {
      if (Date.now() > deadlineAt) throw new Error("enrichment_timeout");
      const sourceUrl = urls[cursor++];
      const image = await importImage({
        productId: proposal!.productId,
        proposalId: proposal!.id,
        supplierId: proposal!.product.supplierId!,
        sourceUrl,
        makePrimary: false,
      });
      imported.set(sourceUrl, image.url);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, urls.length) }, upload));
  if (Date.now() > deadlineAt) throw new Error("enrichment_timeout");
  const prepared = selections.map((selection) => ({
    ...selection,
    imageUrl: selection.imageUrl ? imported.get(selection.imageUrl)! : null,
  }));
  const now = new Date();
  await database.$transaction(async (tx) => {
    const claimed = await tx.productEnrichmentProposal.updateMany({
      where: {
        id: proposal.id,
        status: EnrichmentProposalStatus.PENDING,
        updatedAt: proposal.updatedAt,
      },
      data: {
        status: finalize
          ? EnrichmentProposalStatus.APPLIED
          : EnrichmentProposalStatus.PENDING,
        appliedAt: finalize ? now : null,
        ...(selections.length
          ? {
              facts: {
                ...facts,
                appliedVariantImages: selections,
              } as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
    if (claimed.count !== 1) throw new Error("proposal_changed_refresh");
    const current = await tx.product.findUniqueOrThrow({
      where: { id: proposal.productId },
      select: {
        variants: true,
        updatedAt: true,
        supplierSku: true,
        image: true,
      },
    });
    const currentVariants = normalizeStoredVariants(current.variants);
    if (
      commonFromPrimarySku &&
      !primarySkuPhotoCandidates(
        {
          id: proposal.productId,
          supplierSku: current.supplierSku,
          variants: currentVariants,
        },
        facts,
      ).some((candidate) => candidate.url === commonUrl)
    )
      throw new Error("variant_sku_changed");
    if (
      input.automatic &&
      commonUrl &&
      current.supplierSku !== proposal.product.supplierSku
    )
      throw new Error("variant_sku_changed");
    if (
      input.automatic &&
      ((commonUrl && current.image !== proposal.product.image) ||
        selections.some(
          (selection) =>
            currentVariants.find(
              (variant) => variant.id === selection.variantId,
            )?.image !==
            variants.find((variant) => variant.id === selection.variantId)
              ?.image,
        ))
    )
      throw new Error("product_changed_refresh");
    validateVariantImages(currentVariants, selections, groups);
    let nextVariants = assignVariantImages(currentVariants, prepared);
    if (applyInventory)
      nextVariants = nextVariants.map((variant) => ({
        ...variant,
        stock: input.variantStocks?.[variant.id] ?? variant.stock,
      }));
    const data: Prisma.ProductUpdateManyMutationInput = {
      ...(applyText
        ? {
            shortDescription: proposal.shortDescription?.trim() || null,
            ...(editedName ? { name: editedName } : {}),
            description,
            descriptionSourceUrl: proposal.sourceUrl,
          }
        : {}),
      ...(importedImage
        ? { image: importedImage.url, imageSourceUrl: commonUrl }
        : {}),
      ...(currentVariants.length &&
      (selections.length || (applyInventory && input.variantStocks))
        ? {
            variants: nextVariants,
            stock: nextVariants.reduce(
              (sum, variant) => sum + variant.stock,
              0,
            ),
          }
        : {}),
      ...(!currentVariants.length && applyInventory && input.stock !== undefined
        ? { stock: input.stock }
        : {}),
    };
    if (Object.keys(data).length) {
      const written = await tx.product.updateMany({
        where: { id: proposal.productId, updatedAt: current.updatedAt },
        data,
      });
      if (written.count !== 1) throw new Error("product_changed_refresh");
    }
    if (importedImage) {
      await tx.productImage.updateMany({
        where: { productId: proposal.productId },
        data: { isPrimary: false },
      });
      await tx.productImage.update({
        where: { id: importedImage.id },
        data: { isPrimary: true },
      });
    }
    if (proposal.jobId)
      await tx.enrichmentJob.update({
        where: { id: proposal.jobId },
        data: {
          status: finalize
            ? EnrichmentJobStatus.APPLIED
            : EnrichmentJobStatus.REVIEW,
          finishedAt: finalize ? now : null,
          error: null,
        },
      });
    const pending = await tx.productEnrichmentProposal.count({
      where: {
        productId: proposal.productId,
        status: EnrichmentProposalStatus.PENDING,
        confidence: { gt: 0 },
      },
    });
    await tx.product.update({
      where: { id: proposal.productId },
      data: { enrichmentStatus: pending ? "REVIEW" : "READY" },
    });
  });
  return {
    proposal: await database.productEnrichmentProposal.findUnique({
      where: { id: proposal.id },
      include: { product: true, source: true, job: true },
    }),
    importedImage,
    imagePreserved: !commonUrl,
  };
}
