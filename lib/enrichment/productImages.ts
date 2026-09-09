import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { normalizeProductImage } from "@/lib/productImageNormalization";
import { safeFetchImage, type AllowedSourcePolicy } from "./network";
import {
  getEnabledSupplierSources,
  toAllowedPolicies,
} from "./sourcePolicies";

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function isTrustedProposalImage(productId: string, sourceUrl: string) {
  const proposals = await prisma.productEnrichmentProposal.findMany({
    where: {
      productId,
      status: "PENDING",
      confidence: { gt: 0 },
    },
    select: { images: true },
    take: 20,
  });

  return proposals.some((proposal) => stringArray(proposal.images).includes(sourceUrl));
}

function exactHostPolicy(rawUrl: string): AllowedSourcePolicy | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || url.port) return null;
    const hostname = url.hostname.trim().toLowerCase().replace(/\.$/, "");
    return hostname ? { domain: hostname, allowSubdomains: false } : null;
  } catch {
    return null;
  }
}

async function fetchProposalImage(input: {
  productId: string;
  sourceUrl: string;
  policies: AllowedSourcePolicy[];
}) {
  try {
    return await safeFetchImage(input.sourceUrl, input.policies);
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    if (message !== "source_domain_not_allowed") throw error;

    const trusted = await isTrustedProposalImage(input.productId, input.sourceUrl);
    const exactPolicy = trusted ? exactHostPolicy(input.sourceUrl) : null;
    if (!exactPolicy) throw error;

    return safeFetchImage(input.sourceUrl, [...input.policies, exactPolicy]);
  }
}

export async function importProductImage(input: {
  productId: string;
  supplierId: string;
  sourceUrl: string;
  makePrimary: boolean;
}) {
  const sources = await getEnabledSupplierSources(input.supplierId);
  if (!sources.length) throw new Error("enabled_sources_required");

  const fetched = await fetchProposalImage({
    productId: input.productId,
    sourceUrl: input.sourceUrl,
    policies: toAllowedPolicies(sources),
  });
  const checksum = createHash("sha256").update(fetched.buffer).digest("hex");

  const existing = await prisma.productImage.findFirst({
    where: { productId: input.productId, checksum },
  });

  if (existing) {
    if (input.makePrimary && !existing.isPrimary) {
      await prisma.$transaction([
        prisma.productImage.updateMany({
          where: { productId: input.productId },
          data: { isPrimary: false },
        }),
        prisma.productImage.update({
          where: { id: existing.id },
          data: { isPrimary: true },
        }),
        prisma.product.update({
          where: { id: input.productId },
          data: {
            image: existing.url,
            imageSourceUrl: input.sourceUrl,
          },
        }),
      ]);
    }
    return existing;
  }

  const normalized = await normalizeProductImage(fetched.buffer, {
    folder: "pro-cosmetics/products/enriched-originals",
  });
  const sourceDomain = new URL(fetched.finalUrl).hostname.toLowerCase();

  return prisma.$transaction(async (tx) => {
    if (input.makePrimary) {
      await tx.productImage.updateMany({
        where: { productId: input.productId },
        data: { isPrimary: false },
      });
    }

    const image = await tx.productImage.create({
      data: {
        productId: input.productId,
        url: normalized.url,
        sourceUrl: fetched.finalUrl,
        sourceDomain,
        checksum,
        width: normalized.width,
        height: normalized.height,
        isPrimary: input.makePrimary,
      },
    });

    if (input.makePrimary) {
      await tx.product.update({
        where: { id: input.productId },
        data: {
          image: normalized.url,
          imageSourceUrl: fetched.finalUrl,
        },
      });
    }

    return image;
  });
}
