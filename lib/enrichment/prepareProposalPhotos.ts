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
import { hasManualProposalText } from "./proposalText";
import { hasManualVariantChanges } from "./removedVariants";
import { latestPricePackageLabel, priceListImagesBySku, priceVariantGroups } from "./priceListImages";
import {
  ensureDefaultSupplierSources,
  getEnabledSupplierSources,
  toAllowedPolicies,
} from "./sourcePolicies";
import type { AllowedSourcePolicy } from "./network";
import { photoCandidateIsCurrent } from "./photoIdentity";
import { rateProposalPhotoGroups } from "./ratePhotoCandidates";
import { isProductPhoto } from "./photoQuality";
import { variantPhotoSearchIssue } from "./clientMessages";
import {
  PHOTO_AUTOMATION_VERSION, VARIANT_PHOTO_BUDGET_MS, pendingPhotoTargets,
  photoSearchAttempts, photoTargetKey, unresolvedPhotoSearchIssues,
} from "./photoAutomation";

type PhotoProduct = MatchableProduct & {
  id: string;
  image: string;
  variants: unknown;
  sourceUrl?: string | null;
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
    previousAutomation?: unknown;
    maxTargets?: number;
    restart?: boolean;
    packageLabel?: string;
  },
  search = searchVariantPhotos,
) {
  const variants = normalizeStoredVariants(input.product.variants);
  const primaryId = "product:" + input.product.id;
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
  const currentProduct = { ...input.product, variants };
  const attempts = new Map(photoSearchAttempts(input.previousAutomation).map((item) => [item.key, item]));
  if (input.restart) for (const target of pendingPhotoTargets(currentProduct, { variantImageCandidates: existing })) {
    const key = photoTargetKey(currentProduct, target);
    const previous = attempts.get(key);
    // Explicit retry resets the cooldown, retaining unresolved issues until that SKU is checked.
    if (previous) attempts.set(key, { ...previous, retryAt: new Date().toISOString() });
  }
  const targets = pendingPhotoTargets(currentProduct, {
    variantImageCandidates: existing,
    photoAutomation: { version: PHOTO_AUTOMATION_VERSION, attempts: [...attempts.values()] },
  }).slice(0, input.maxTargets ?? Infinity);
  let cursor = 0;
  const found: VariantImageGroup[] = [];
  async function worker() {
    while (cursor < targets.length && Date.now() < input.deadlineAt - 1_000) {
      const target = targets[cursor++];
      const fullBudget = input.deadlineAt - Date.now() >= VARIANT_PHOTO_BUDGET_MS - 5_000;
      const key = photoTargetKey(currentProduct, target);
      const recordAttempt = (incomplete: boolean, issues: string[]) => attempts.set(key, { key, issues,
        // A short discovery budget must never cache an unfinished SKU for a day.
        retryAt: new Date(Date.now() + (fullBudget ? (incomplete ? 15 * 60_000 : 24 * 60 * 60_000) : 0)).toISOString(),
      });
      const previous = existing.find(
        (group) =>
          group.variantId === target.id &&
          photoSku(group.sku) === photoSku(target.sku),
      );
      try {
        const result = await search({
          product: input.product,
          variant: { ...target, label: target.label || "" },
          knownUrl: input.product.sourceUrl,
          knownUrls: [input.knownUrl],
          officialDomains: input.officialDomains,
          policies: input.policies,
          priceCandidates:
            previous?.candidates.filter(
              (item) => item.source === "PRICE_LIST",
            ) || [],
          catalogOnly: false,
          allowNamedCommonPhoto: !variants.length && target.id === primaryId,
          packageLabel: !variants.length ? input.packageLabel : undefined,
          deadlineAt: input.deadlineAt,
        });
        if (photoSku(result.sku) !== photoSku(target.sku)) {
          recordAttempt(true, ["variant_sku_changed"]);
          continue;
        }
        found.push({
          variantId: target.id,
          sku: target.sku || "",
          candidates: result.candidates,
        });
        const verifiedPhoto = result.candidates.some((candidate) => candidate.source === "WEB" &&
          isProductPhoto(candidate.url) && photoCandidateIsCurrent(candidate, currentProduct, target));
        recordAttempt(result.status === "INCOMPLETE" || result.issues.length > 0,
          verifiedPhoto ? [] : result.issues.map((issue) => issue.code));
      } catch (error) {
        recordAttempt(true, [variantPhotoSearchIssue(error).code]);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(2, targets.length) }, worker),
  );
  const all = mergeImageGroups(found, existing);
  const automation = { version: PHOTO_AUTOMATION_VERSION, attempts: [...attempts.values()].slice(-500) };
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
      ...automation,
      checkedAt: new Date().toISOString(),
      issues: unresolvedPhotoSearchIssues(currentProduct, {
        variantImageCandidates: all, photoAutomation: automation,
      }),
      incomplete: pendingPhotoTargets(currentProduct, {
        variantImageCandidates: all, photoAutomation: automation,
      }).length > 0,
    },
  };
}

export async function prepareProposalPhotos(
  proposalId: string,
  options: { automatic?: boolean; resume?: boolean } = {},
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
  const groups = mergeImageGroups(imageGroups(facts.variantImageCandidates), priceGroups);
  if (
    (options.automatic || options.resume) &&
    !(facts.photoAutomation as { qualityIncomplete?: boolean } | null)?.qualityIncomplete &&
    !pendingPhotoTargets({ ...product, variants }, {
      ...facts, variantImageCandidates: groups,
    }).length
  ) {
    return {
      variantImageCandidates: groups,
      productImageCandidates: imageGroups(facts.productImageCandidates),
      images: Array.isArray(proposal.images) ? proposal.images : [],
      photoAutomation: { ...((facts.photoAutomation || {}) as Record<string, unknown>), incomplete: false,
        issues: unresolvedPhotoSearchIssues({ ...product, variants }, { ...facts, variantImageCandidates: groups }),
      },
    };
  }
  const collected = await collectProposalPhotos({
    product,
    groups,
    packageLabel: !variants.length ? await latestPricePackageLabel(product.id, product.supplierSku) : "",
    productGroups: imageGroups(facts.productImageCandidates),
    knownUrl: proposal.sourceUrl,
    officialDomains: sources
      .filter((source) => source.sourceType === "OFFICIAL_SITE")
      .map((source) => source.domain),
    policies: toAllowedPolicies(sources),
    deadlineAt: Date.now() + VARIANT_PHOTO_BUDGET_MS,
    maxTargets: 2,
    previousAutomation: facts.photoAutomation,
    restart: !options.automatic && !options.resume,
  });
  const photos = await rateProposalPhotoGroups(collected, {
    policies: toAllowedPolicies(sources),
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
