import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

type PublicationFields = {
  brandId: string | null;
  shortDescription: string | null;
  description: string;
  image: string;
  category: string;
  price: number;
};

export function publicationMissingFields(
  product: PublicationFields,
  options: {
    imported: boolean;
    hasAppliedEnrichment: boolean;
    reviewedInEditor?: boolean;
  },
) {
  const missing: string[] = [];
  const description = product.description.trim().toLocaleLowerCase("ru-RU");
  // Explicit publication from the full editor also confirms the administrator's
  // manual review. Queue publication still requires an applied AI suggestion.
  if (
    options.imported &&
    !options.hasAppliedEnrichment &&
    !options.reviewedInEditor
  ) {
    missing.push("одобрение описания и фото");
  }
  if (!product.brandId) missing.push("бренд");
  if (!product.shortDescription?.trim()) missing.push("краткое описание");
  if (!description || description === "описание готовится")
    missing.push("описание");
  if (!product.image || product.image.startsWith("/seed/"))
    missing.push("фотография");
  if (!product.category.trim()) missing.push("категория");
  if (product.price <= 0) missing.push("цена");
  return missing;
}

export async function publishEditedProduct(
  input: {
    productId: string;
    expectedUpdatedAt: Date;
    data: Prisma.ProductUncheckedUpdateInput;
  },
  database = prisma,
) {
  return database.$transaction(async (tx) => {
    const activeJob = await tx.enrichmentJob.findFirst({
      where: {
        productId: input.productId,
        status: { in: ["PENDING", "RUNNING"] },
      },
      select: { id: true },
    });
    if (activeJob) throw new Error("publication_enrichment_running");
    const written = await tx.product.updateMany({
      where: {
        id: input.productId,
        updatedAt: input.expectedUpdatedAt,
        enrichmentStatus: { notIn: ["RUNNING", "MERGED"] },
      },
      data: { ...input.data, isPublished: true, enrichmentStatus: "READY" },
    });
    if (written.count !== 1) throw new Error("product_changed_refresh");
    // Pending AI suggestions must not overwrite text reviewed in this editor.
    await tx.productEnrichmentProposal.updateMany({
      where: { productId: input.productId, status: "PENDING" },
      data: { status: "REJECTED" },
    });
    await tx.enrichmentJob.updateMany({
      where: { productId: input.productId, status: "REVIEW" },
      data: { status: "CANCELED", finishedAt: new Date() },
    });
    return tx.product.findUniqueOrThrow({
      where: { id: input.productId },
      include: { brand: true, supplier: true },
    });
  });
}
