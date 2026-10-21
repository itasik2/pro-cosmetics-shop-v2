import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeStoredVariants } from "@/lib/price-import/productVariants";
import type { MatchableProduct } from "./matchProduct";
import {
  imageGroups,
  mergeImageGroups,
  photoSku,
  type VariantImageGroup,
} from "./variantImages";
import { searchVariantPhotos } from "./variantPhotoSearch";
import { isProductPhoto, isUsablePhoto } from "./photoQuality";
import { hasManualProposalText } from "./proposalText";
import { hasManualVariantChanges } from "./removedVariants";
import { priceListImagesBySku, priceVariantGroups } from "./priceListImages";
import {
  ensureDefaultSupplierSources,
  getEnabledSupplierSources,
  toAllowedPolicies,
} from "./sourcePolicies";
import type { AllowedSourcePolicy } from "./network";
import { hasManufacturerSku, photoCandidateIsCurrent } from "./photoIdentity";

type PhotoProduct = MatchableProduct & {
  id: string;
  image: string;
  variants: unknown;
};
export async function collectProposalPhotos(
  input: {
    product: PhotoProduct;
    groups: VariantImageGroup[];
    productGroups?: VariantImageGroup[];
    knownUrl: string;
    officialDomains: string[];
    policies: AllowedSourcePolicy[];
    deadlineAt: number;
  },
  search = searchVariantPhotos,
) {
  const variants = normalizeStoredVariants(input.product.variants);
  const primaryId = "product:" + input.product.id;
  const primarySku = input.product.supplierSku || variants[0]?.sku;
  const primaryLabel =
    input.product.volumeValue && input.product.volumeUnit
      ? `${input.product.volumeValue} ${input.product.volumeUnit}`
      : "";
  const existing = mergeImageGroups(
    input.groups,
    input.productGroups || [],
  ).map((group) => ({
    ...group,
    candidates: group.candidates.filter((candidate) =>
      photoCandidateIsCurrent(
        candidate,
        input.product,
        variants.find((variant) => variant.id === group.variantId) || {
          label: primaryLabel,
        },
      ),
    ),
  }));
  const targets = [
    ...variants.filter((variant) => !isUsablePhoto(variant.image)),
    ...(!isUsablePhoto(input.product.image) &&
    (!variants.length || primarySku) &&
    !variants.some((variant) => photoSku(variant.sku) === photoSku(primarySku))
      ? [{ id: primaryId, sku: primarySku || "", label: primaryLabel }]
      : []),
  ].filter(
    (target) =>
      (target.sku || (target.id === primaryId && input.product.brand?.name)) &&
      !existing.some(
        (group) =>
          group.variantId === target.id &&
          photoSku(group.sku) === photoSku(target.sku) &&
          group.candidates.some(
            (candidate) =>
              candidate.source === "WEB" &&
              isProductPhoto(candidate.url) &&
              photoCandidateIsCurrent(candidate, input.product, target),
          ),
      ),
  );
  let cursor = 0;
  const found: VariantImageGroup[] = [];
  const issues: string[] = [];
  async function worker() {
    while (cursor < targets.length && Date.now() < input.deadlineAt - 1_000) {
      const target = targets[cursor++];
      const previous = existing.find(
        (group) =>
          group.variantId === target.id &&
          photoSku(group.sku) === photoSku(target.sku),
      );
      try {
        const result = await search({
          product: input.product,
          variant: target,
          knownUrl: input.knownUrl,
          officialDomains: input.officialDomains,
          policies: input.policies,
          priceCandidates:
            previous?.candidates.filter(
              (item) => item.source === "PRICE_LIST",
            ) || [],
          catalogOnly: hasManufacturerSku(target.sku),
          deadlineAt: input.deadlineAt,
        });
        if (photoSku(result.sku) !== photoSku(target.sku)) {
          issues.push("variant_sku_changed");
          continue;
        }
        found.push({
          variantId: target.id,
          sku: target.sku || "",
          candidates: result.candidates,
        });
        issues.push(...result.issues.map((issue) => issue.code));
      } catch {
        issues.push("photo_search_incomplete");
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(2, targets.length) }, worker),
  );
  const all = mergeImageGroups(found, existing);
  return {
    variantImageCandidates: all.filter((group) =>
      variants.some(
        (variant) =>
          variant.id === group.variantId &&
          photoSku(variant.sku) === photoSku(group.sku),
      ),
    ),
    productImageCandidates: all.filter(
      (group) => group.variantId === primaryId,
    ),
    photoAutomation: {
      version: 4,
      checkedAt: new Date().toISOString(),
      issues: [...new Set(issues)],
      incomplete: cursor < targets.length,
    },
  };
}

export async function prepareProposalPhotos(
  proposalId: string,
  options: { automatic?: boolean } = {},
) {
  const proposal = await prisma.productEnrichmentProposal.findUnique({
    where: { id: proposalId },
    include: {
      product: {
        include: { brand: { select: { name: true } }, supplier: true },
      },
    },
  });
  if (!proposal || proposal.status !== "PENDING")
    throw new Error("proposal_not_pending");
  if (options.automatic && hasManualProposalText(proposal.facts))
    throw new Error("manual_text_review_required");
  if (options.automatic && hasManualVariantChanges(proposal.facts))
    throw new Error("manual_variant_review_required");
  const { product } = proposal;
  if (!product.supplier) throw new Error("product_supplier_required");
  await ensureDefaultSupplierSources({
    supplierId: product.supplier.id,
    supplierName: product.supplier.name,
    supplierSlug: product.supplier.slug,
    brandName: product.brand?.name,
  });
  const sources = await getEnabledSupplierSources(product.supplier.id);
  const variants = normalizeStoredVariants(product.variants);
  const prices = await priceListImagesBySku([product.id]);
  const primarySku = product.supplierSku || variants[0]?.sku;
  const priceGroups = priceVariantGroups(
    product.id,
    [
      ...variants,
      ...(primarySku ? [{ id: "product:" + product.id, sku: primarySku }] : []),
    ],
    prices,
  );
  const facts =
    proposal.facts &&
    typeof proposal.facts === "object" &&
    !Array.isArray(proposal.facts)
      ? (proposal.facts as Record<string, unknown>)
      : {};
  const previous = facts.photoAutomation as
    | { checkedAt?: string; version?: number }
    | undefined;
  if (
    options.automatic &&
    previous?.version === 4 &&
    previous?.checkedAt &&
    Date.now() - new Date(previous.checkedAt).getTime() < 24 * 60 * 60 * 1000
  ) {
    return {
      variantImageCandidates: imageGroups(facts.variantImageCandidates),
      productImageCandidates: imageGroups(facts.productImageCandidates),
      images: Array.isArray(proposal.images) ? proposal.images : [],
    };
  }
  const photos = await collectProposalPhotos({
    product,
    groups: mergeImageGroups(
      imageGroups(facts.variantImageCandidates),
      priceGroups,
    ),
    productGroups: imageGroups(facts.productImageCandidates),
    knownUrl: proposal.sourceUrl,
    officialDomains: sources
      .filter((source) => source.sourceType === "OFFICIAL_SITE")
      .map((source) => source.domain),
    policies: toAllowedPolicies(sources),
    deadlineAt: Date.now() + 90_000,
  });
  const images = [
    ...new Set([
      ...(Array.isArray(proposal.images)
        ? proposal.images.filter(
            (url): url is string => typeof url === "string",
          )
        : []),
      ...[
        ...photos.variantImageCandidates,
        ...photos.productImageCandidates,
      ].flatMap((group) => group.candidates.map((candidate) => candidate.url)),
    ]),
  ];
  await prisma.$transaction(async (tx) => {
    const current = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { updatedAt: true },
    });
    if (+current.updatedAt !== +product.updatedAt)
      throw new Error("product_changed_refresh");
    const written = await tx.productEnrichmentProposal.updateMany({
      where: {
        id: proposalId,
        status: "PENDING",
        updatedAt: proposal.updatedAt,
      },
      data: {
        images,
        facts: { ...facts, ...photos } as unknown as Prisma.InputJsonValue,
      },
    });
    if (written.count !== 1) throw new Error("proposal_changed_refresh");
  });
  return { ...photos, images };
}
