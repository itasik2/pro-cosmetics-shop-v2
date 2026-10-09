import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { safeFetchImage, sourcePolicyForUrl } from "../ai/network.js";
import { prisma } from "../offline/staging-store.js";
import { masterCardSchema } from "../offline/master-card.js";
import { createChangeSet } from "../offline/staging-store.js";
import { stagingPatchSchema } from "../offline/staging.js";
import { analyzeImage } from "./image.js";
import {
  cloudinaryMediaConfigured,
  uploadCatalogImageProfiles,
} from "./cloudinary.js";
import {
  getMediaProfile,
  mediaProfilesDatabaseConfigured,
} from "./profiles.js";

const importMediaSchema = z
  .object({
    organizationId: z.string().min(1),
    productId: z.string().min(1).optional(),
    sku: z.string().trim().min(1).optional(),
    sourceUrl: z.string().url(),
    profileCodes: z.array(z.string().trim().min(1)).min(1).max(12),
    makePrimary: z.boolean().default(false),
  })
  .refine((value) => Boolean(value.productId || value.sku), {
    message: "productId_or_sku_required",
  });

const stageMediaSchema = z.object({
  organizationId: z.string().min(1),
  variantId: z.string().min(1),
  replaceAllImages: z.boolean().default(false),
  createdBy: z.string().optional(),
});

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mimeForFormat(format: string) {
  return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}

function exactSourcePolicy(rawUrl: string) {
  const url = new URL(rawUrl);
  return {
    domain: url.hostname.toLowerCase(),
    allowSubdomains: false,
    sourceType: "DISCOVERED_WEB" as const,
  };
}

async function resolveProduct(input: z.infer<typeof importMediaSchema>) {
  const where = input.productId
    ? { id: input.productId, organizationId: input.organizationId }
    : {
        organizationId_sku: {
          organizationId: input.organizationId,
          sku: input.sku!,
        },
      };

  if (input.productId) {
    return prisma.product.findFirst({
      where,
      include: {
        supplierLinks: {
          include: {
            supplier: {
              include: {
                sourcePolicies: { where: { isEnabled: true } },
              },
            },
          },
        },
      },
    });
  }

  return prisma.product.findUnique({
    where,
    include: {
      supplierLinks: {
        include: {
          supplier: {
            include: {
              sourcePolicies: { where: { isEnabled: true } },
            },
          },
        },
      },
    },
  });
}

async function trustedProposalImage(productId: string, sourceUrl: string) {
  const proposals = await prisma.catalogEnrichmentProposal.findMany({
    where: {
      productId,
      status: "PENDING",
    },
    select: { images: true },
    take: 20,
  });

  return proposals.some((proposal) =>
    strings(proposal.images).includes(sourceUrl),
  );
}

function sourcePolicies(product: NonNullable<Awaited<ReturnType<typeof resolveProduct>>>) {
  const seen = new Set<string>();
  const result: Array<{
    domain: string;
    allowSubdomains: boolean;
    sourceType: "OFFICIAL_SITE" | "DISTRIBUTOR" | "DISCOVERED_WEB";
  }> = [];

  for (const link of product.supplierLinks) {
    for (const policy of link.supplier.sourcePolicies) {
      const sourceType = ["OFFICIAL_SITE", "DISTRIBUTOR", "DISCOVERED_WEB"].includes(
        policy.sourceType,
      )
        ? (policy.sourceType as "OFFICIAL_SITE" | "DISTRIBUTOR" | "DISCOVERED_WEB")
        : "DISTRIBUTOR";
      const key = `${policy.domain}:${policy.allowSubdomains}:${sourceType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        domain: policy.domain,
        allowSubdomains: policy.allowSubdomains,
        sourceType,
      });
    }
  }

  return result;
}

export function mediaStoreConfigured() {
  return mediaProfilesDatabaseConfigured() && cloudinaryMediaConfigured();
}

export async function importProductMedia(raw: unknown) {
  const input = importMediaSchema.parse(raw);
  if (!cloudinaryMediaConfigured()) throw new Error("cloudinary_not_configured");

  const product = await resolveProduct(input);
  if (!product) throw new Error("product_not_found");

  const policies = sourcePolicies(product);
  const trusted = await trustedProposalImage(product.id, input.sourceUrl);
  if (!sourcePolicyForUrl(policies, input.sourceUrl) && trusted) {
    policies.push(exactSourcePolicy(input.sourceUrl));
  }

  const fetched = await safeFetchImage(input.sourceUrl, policies);
  const analysis = await analyzeImage(fetched.buffer);
  const fileHash = createHash("sha256").update(fetched.buffer).digest("hex");

  const existing = await prisma.productMedia.findFirst({
    where: {
      productId: product.id,
      fileHash,
    },
    include: { variants: true },
  });
  if (existing) return { reused: true, media: existing };

  const profiles = [];
  for (const code of [...new Set(input.profileCodes)]) {
    const profile = await getMediaProfile({
      organizationId: input.organizationId,
      code,
    });
    if (!profile || !profile.isActive) {
      throw new Error(`media_profile_not_found:${code}`);
    }
    profiles.push(profile);
  }

  const uploaded = await uploadCatalogImageProfiles(
    fetched.buffer,
    profiles.map((profile) => ({
      code: profile.code,
      width: profile.width,
      height: profile.height,
      mode: profile.mode,
      format: profile.format,
      quality: profile.quality,
      background: profile.background,
      allowUpscale: profile.allowUpscale,
      removeBackground: profile.removeBackground,
      trim: profile.trim,
    })),
  );

  const failed = uploaded.variants.filter((variant) => !variant.url);
  if (failed.length) {
    throw new Error(
      "media_variant_generation_failed:" +
        failed.map((variant) => variant.profileCode).join(","),
    );
  }

  const media = await prisma.$transaction(async (tx) => {
    if (input.makePrimary) {
      await tx.productMedia.updateMany({
        where: { productId: product.id },
        data: { isPrimary: false },
      });
    }

    return tx.productMedia.create({
      data: {
        productId: product.id,
        sourceType: trusted ? "AI_PROPOSAL" : "WEB",
        sourceUrl: fetched.finalUrl,
        originalFormat: analysis.format,
        mimeType: analysis.mimeType,
        width: analysis.width,
        height: analysis.height,
        sizeBytes: analysis.bytes,
        fileHash,
        isPrimary: input.makePrimary,
        status: "PROCESSED",
        metadata: json({
          cloudinaryPublicId: uploaded.publicId,
          cloudinaryOriginalUrl: uploaded.originalUrl,
          sourceContentType: fetched.contentType,
          analysis,
        }),
        variants: {
          create: uploaded.variants.map((variant) => ({
            preset: variant.profileCode,
            format: variant.format,
            mimeType: mimeForFormat(variant.format),
            width: variant.width,
            height: variant.height,
            sizeBytes: variant.bytes ?? 0,
            url: variant.url!,
          })),
        },
      },
      include: {
        variants: { orderBy: { preset: "asc" } },
      },
    });
  });

  return {
    reused: false,
    media,
  };
}

export async function listProductMedia(input: {
  organizationId: string;
  productId: string;
}) {
  const product = await prisma.product.findFirst({
    where: {
      id: input.productId,
      organizationId: input.organizationId,
    },
    select: { id: true },
  });
  if (!product) throw new Error("product_not_found");

  return prisma.productMedia.findMany({
    where: { productId: product.id },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
    include: {
      variants: { orderBy: { preset: "asc" } },
    },
  });
}

export async function stageProductMediaVariant(raw: unknown) {
  const input = stageMediaSchema.parse(raw);
  const variant = await prisma.mediaVariant.findFirst({
    where: {
      id: input.variantId,
      media: {
        product: { organizationId: input.organizationId },
      },
    },
    include: {
      media: {
        include: {
          product: {
            include: { inventory: true },
          },
        },
      },
    },
  });

  if (!variant?.url) throw new Error("media_variant_not_found");

  const product = variant.media.product;
  const stock = product.inventory.reduce((sum, item) => sum + item.onHand, 0);
  const currentImages = strings(product.images);
  const nextImages = input.replaceAllImages
    ? [variant.url]
    : [variant.url, ...currentImages.filter((url) => url !== variant.url)];

  const current = masterCardSchema.parse({
    sku: product.sku,
    barcode: product.barcode || undefined,
    title: product.title,
    brand: product.brand || undefined,
    shortDescription: product.shortDescription || undefined,
    description: product.description || undefined,
    application: product.application || undefined,
    ingredients: product.ingredients || undefined,
    categoryKey: product.categoryKey || undefined,
    attributes: record(product.attributes),
    images: currentImages,
    purchasePrice: product.purchasePrice ?? undefined,
    price: product.basePrice ?? undefined,
    stock,
  });

  const proposed = stagingPatchSchema.parse({ images: nextImages });

  return createChangeSet({
    organizationId: input.organizationId,
    productId: product.id,
    sourceType:
      variant.media.sourceType === "AI_PROPOSAL" ? "AI_ENRICHMENT" : "MANUAL",
    sourceRef: variant.id,
    current,
    proposed,
    createdBy: input.createdBy,
  });
}
