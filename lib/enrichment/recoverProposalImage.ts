import { prisma } from "@/lib/prisma";
import { normalizeStoredVariants } from "@/lib/price-import/productVariants";
import { hasManufacturerSku, photoCandidateIsCurrent } from "./photoIdentity";
import { imageGroups, photoSku } from "./variantImages";
import { searchVariantPhotos } from "./variantPhotoSearch";
import { safeFetchImage, type AllowedSourcePolicy } from "./network";
import { isProductPhoto } from "./photoQuality";

export function recoverablePhotoDownloadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /^source_(?:content_type_not_allowed:|http_(?:403|404|410|429|5\d\d)$|access_blocked$|timeout$|fetch_failed:)/.test(message);
}

/** A failed download may be replaced only with a photo verified for the same current SKU. */
export async function recoverProposalImage(input: {
  productId: string; supplierId: string; proposalId?: string; sourceUrl: string;
  policies: AllowedSourcePolicy[]; officialDomains: string[];
  deadlineAt?: number;
}, dependencies = { database: prisma, search: searchVariantPhotos, fetchImage: safeFetchImage }) {
  if (!input.proposalId) return null;
  const proposal = await dependencies.database.productEnrichmentProposal.findFirst({
    where: { id: input.proposalId, productId: input.productId, status: "PENDING", confidence: { gt: 0 } },
    include: { product: { include: { brand: true, supplier: true } } },
  });
  if (!proposal || proposal.product.supplierId !== input.supplierId) return null;
  const product = proposal.product;
  const variants = normalizeStoredVariants(product.variants);
  const facts = proposal.facts as Record<string, unknown> | null;
  const groups = [...imageGroups(facts?.productImageCandidates), ...imageGroups(facts?.variantImageCandidates)];
  const matches = groups.flatMap(group => {
    const variant = variants.find(row => row.id === group.variantId && photoSku(row.sku) === photoSku(group.sku));
    const primary = group.variantId === "product:" + product.id && photoSku(group.sku) === photoSku(product.supplierSku);
    if (!variant && !primary) return [];
    const target = variant || { sku: product.supplierSku || "", label:
      product.volumeValue && product.volumeUnit ? `${product.volumeValue} ${product.volumeUnit}` : "" };
    return group.candidates.some(candidate => candidate.url === input.sourceUrl &&
      photoCandidateIsCurrent(candidate, product, target)) ? [{ group, target }] : [];
  });
  if (new Set(matches.map(row => photoSku(row.target.sku))).size !== 1 ||
    !hasManufacturerSku(matches[0]?.target.sku)) return null;
  const { target } = matches[0];
  const excludedUrls = [...new Set(matches.flatMap(row => row.group.candidates
    .filter(candidate => candidate.url === input.sourceUrl && candidate.sourceUrl)
    .map(candidate => candidate.sourceUrl!)))];
  const knownUrls = [...new Set(groups.flatMap(group => group.candidates
    .flatMap(candidate => candidate.sourceUrl ? [candidate.sourceUrl] : [])))];
  const deadlineAt = Math.min(input.deadlineAt ?? Infinity, Date.now() + 60_000);
  if (deadlineAt <= Date.now() + 1000) return null;
  const result = await dependencies.search({ product, variant: { sku: target.sku, label: target.label || "" },
    knownUrls, excludedUrls, officialDomains: input.officialDomains, policies: input.policies,
    priceCandidates: [], catalogOnly: true, deadlineAt });
  if (photoSku(result.sku) !== photoSku(target.sku)) return null;
  for (const candidate of result.candidates.slice(0, 3)) {
    if (candidate.url === input.sourceUrl || candidate.source !== "WEB" || !isProductPhoto(candidate.url) ||
      !photoCandidateIsCurrent(candidate, product, target) || Date.now() >= deadlineAt) continue;
    try {
      const url = new URL(candidate.url);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) continue;
      return await dependencies.fetchImage(candidate.url, [...input.policies,
        { domain: url.hostname, allowSubdomains: false }], { timeoutMs: Math.min(10_000, deadlineAt - Date.now()) });
    } catch { /* Try another verified image, retaining the original download error on failure. */ }
  }
  return null;
}
