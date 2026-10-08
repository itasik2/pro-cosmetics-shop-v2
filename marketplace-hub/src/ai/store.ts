import {
  CatalogEnrichmentJobStatus,
  CatalogEnrichmentProposalStatus,
  type Prisma,
} from "@prisma/client";
import { z } from "zod";
import { buildEnrichmentProposal } from "./enrich.js";
import { prisma } from "../offline/staging-store.js";
import { createChangeSet } from "../offline/staging-store.js";
import { masterCardSchema } from "../offline/master-card.js";
import { stagingPatchSchema } from "../offline/staging.js";

const jobInputSchema = z
  .object({
    organizationId: z.string().min(1),
    productId: z.string().min(1).optional(),
    sku: z.string().trim().min(1).optional(),
    sourceUrl: z.string().url().optional(),
    discoverIfMissing: z.boolean().default(true),
    allowExternalSearch: z.boolean().default(false),
  })
  .refine((value) => Boolean(value.productId || value.sku), {
    message: "productId_or_sku_required",
  });

const stageInputSchema = z.object({
  organizationId: z.string().min(1),
  proposalId: z.string().min(1),
  includeTitle: z.boolean().default(false),
  includeBrand: z.boolean().default(false),
  selectedImageUrl: z.string().url().optional(),
  createdBy: z.string().optional(),
});

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function errorMessage(error: unknown) {
  return String(
    error && typeof error === "object" && "message" in error
      ? (error as { message?: unknown }).message
      : error || "catalog_enrichment_failed",
  ).slice(0, 1000);
}

function hostnameMatches(
  hostname: string,
  domain: string,
  allowSubdomains: boolean,
) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const base = domain.toLowerCase().replace(/\.$/, "");
  return host === base || (allowSubdomains && host.endsWith("." + base));
}

async function resolveProduct(input: z.infer<typeof jobInputSchema>) {
  if (input.productId) {
    return prisma.product.findFirst({
      where: {
        id: input.productId,
        organizationId: input.organizationId,
      },
      include: {
        supplierLinks: {
          include: {
            supplier: {
              include: {
                sourcePolicies: {
                  where: { isEnabled: true },
                  orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
                },
              },
            },
          },
        },
      },
    });
  }

  return prisma.product.findUnique({
    where: {
      organizationId_sku: {
        organizationId: input.organizationId,
        sku: input.sku!,
      },
    },
    include: {
      supplierLinks: {
        include: {
          supplier: {
            include: {
              sourcePolicies: {
                where: { isEnabled: true },
                orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
              },
            },
          },
        },
      },
    },
  });
}

function productVolume(attributes: unknown) {
  const data = record(attributes);
  const rawValue = Number(data.volumeValue);
  const volumeValue =
    Number.isFinite(rawValue) && rawValue > 0 ? rawValue : undefined;
  const volumeUnit =
    typeof data.volumeUnit === "string" && data.volumeUnit.trim()
      ? data.volumeUnit.trim()
      : undefined;
  return { volumeValue, volumeUnit };
}

function sourcePolicies(product: Awaited<ReturnType<typeof resolveProduct>>) {
  if (!product) return [];
  const seen = new Set<string>();
  const policies: Array<{
    id: string;
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
      const key = `${policy.domain.toLowerCase()}:${policy.allowSubdomains}:${sourceType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      policies.push({
        id: policy.id,
        domain: policy.domain,
        allowSubdomains: policy.allowSubdomains,
        sourceType,
      });
    }
  }

  return policies;
}

export async function createCatalogEnrichmentJob(raw: unknown) {
  const input = jobInputSchema.parse(raw);
  const product = await resolveProduct(input);
  if (!product) throw new Error("product_not_found");

  return prisma.catalogEnrichmentJob.create({
    data: {
      productId: product.id,
      status: CatalogEnrichmentJobStatus.PENDING,
      sourceUrl: input.sourceUrl || null,
      result: json({
        organizationId: input.organizationId,
        discoverIfMissing: input.discoverIfMissing,
        allowExternalSearch: input.allowExternalSearch,
      }),
    },
  });
}

export async function runCatalogEnrichmentJob(input: {
  organizationId: string;
  jobId: string;
}) {
  const job = await prisma.catalogEnrichmentJob.findFirst({
    where: {
      id: input.jobId,
      product: { organizationId: input.organizationId },
    },
    include: {
      product: {
        include: {
          supplierLinks: {
            include: {
              supplier: {
                include: {
                  sourcePolicies: {
                    where: { isEnabled: true },
                    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!job) throw new Error("enrichment_job_not_found");
  if (
    ![
      CatalogEnrichmentJobStatus.PENDING,
      CatalogEnrichmentJobStatus.FAILED,
    ].includes(job.status)
  ) {
    throw new Error("enrichment_job_not_runnable");
  }

  const metadata = record(job.result);
  const policies = sourcePolicies(job.product);
  const volume = productVolume(job.product.attributes);

  await prisma.catalogEnrichmentJob.update({
    where: { id: job.id },
    data: {
      status: CatalogEnrichmentJobStatus.RUNNING,
      startedAt: new Date(),
      finishedAt: null,
      error: null,
      attempt: { increment: 1 },
    },
  });

  try {
    const result = await buildEnrichmentProposal({
      product: {
        sku: job.product.sku,
        title: job.product.title,
        brand: job.product.brand || undefined,
        barcode: job.product.barcode || undefined,
        categoryKey: job.product.categoryKey || undefined,
        description: job.product.description || undefined,
        ...volume,
      },
      sourceUrl: job.sourceUrl || undefined,
      discoverIfMissing: metadata.discoverIfMissing !== false,
      allowExternalSearch: metadata.allowExternalSearch === true,
      sources: policies.map((policy) => ({
        domain: policy.domain,
        allowSubdomains: policy.allowSubdomains,
        sourceType: policy.sourceType,
      })),
    });

    const sourceHost = new URL(result.source.url).hostname;
    const policy = policies.find((item) =>
      hostnameMatches(sourceHost, item.domain, item.allowSubdomains),
    );

    const source = await prisma.productSourceSnapshot.upsert({
      where: {
        productId_url: {
          productId: job.productId,
          url: result.source.url,
        },
      },
      update: {
        sourcePolicyId: policy?.id || null,
        canonicalUrl: result.extracted.canonicalUrl,
        title: result.extracted.title,
        sourceType: result.source.sourceType,
        httpStatus: result.source.httpStatus,
        rawData: json({
          contentType: result.source.contentType,
          search: result.source.search,
        }),
        extractedData: json(result.extracted),
        lastCheckedAt: new Date(),
        lastChangedAt: new Date(),
      },
      create: {
        productId: job.productId,
        sourcePolicyId: policy?.id || null,
        url: result.source.url,
        canonicalUrl: result.extracted.canonicalUrl,
        title: result.extracted.title,
        sourceType: result.source.sourceType,
        httpStatus: result.source.httpStatus,
        rawData: json({
          contentType: result.source.contentType,
          search: result.source.search,
        }),
        extractedData: json(result.extracted),
        lastCheckedAt: new Date(),
        lastChangedAt: new Date(),
      },
    });

    const proposal = await prisma.catalogEnrichmentProposal.create({
      data: {
        productId: job.productId,
        sourceId: source.id,
        jobId: job.id,
        sourceUrl: result.source.url,
        confidence: result.match.confidence,
        title: result.extracted.title,
        shortDescription: result.draft.shortDescription || null,
        description: result.draft.description || null,
        application: result.draft.application || null,
        ingredients: result.draft.ingredients || null,
        images: json(result.imageCandidates.map((item) => item.url)),
        facts: json({
          source: result.source,
          match: result.match,
          extracted: result.extracted,
          draft: result.draft,
          imageCandidates: result.imageCandidates,
        }),
        warnings: json(result.warnings),
        evaluation: json(result.evaluation),
        status: CatalogEnrichmentProposalStatus.PENDING,
      },
    });

    await prisma.catalogEnrichmentJob.update({
      where: { id: job.id },
      data: {
        status: CatalogEnrichmentJobStatus.REVIEW,
        sourceUrl: result.source.url,
        result: json({
          ...metadata,
          proposalId: proposal.id,
          confidence: result.match.confidence,
          decision: result.evaluation.decision,
        }),
        finishedAt: new Date(),
        error: null,
      },
    });

    return prisma.catalogEnrichmentProposal.findUnique({
      where: { id: proposal.id },
      include: {
        source: true,
        job: true,
        product: {
          select: {
            id: true,
            organizationId: true,
            sku: true,
            title: true,
            brand: true,
          },
        },
      },
    });
  } catch (error) {
    const message = errorMessage(error);
    await prisma.catalogEnrichmentJob.update({
      where: { id: job.id },
      data: {
        status: CatalogEnrichmentJobStatus.FAILED,
        finishedAt: new Date(),
        error: message,
      },
    });
    throw new Error(message);
  }
}

export async function getCatalogEnrichmentJob(input: {
  organizationId: string;
  jobId: string;
}) {
  return prisma.catalogEnrichmentJob.findFirst({
    where: {
      id: input.jobId,
      product: { organizationId: input.organizationId },
    },
    include: {
      proposals: {
        orderBy: { createdAt: "desc" },
      },
      product: {
        select: { id: true, sku: true, title: true, brand: true },
      },
    },
  });
}

export async function listCatalogEnrichmentProposals(input: {
  organizationId: string;
  status?: "PENDING" | "APPLIED" | "REJECTED";
  limit?: number;
}) {
  return prisma.catalogEnrichmentProposal.findMany({
    where: {
      product: { organizationId: input.organizationId },
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(100, input.limit ?? 50)),
    include: {
      product: {
        select: { id: true, sku: true, title: true, brand: true },
      },
      source: true,
    },
  });
}

export async function stageCatalogEnrichmentProposal(raw: unknown) {
  const input = stageInputSchema.parse(raw);
  const proposal = await prisma.catalogEnrichmentProposal.findFirst({
    where: {
      id: input.proposalId,
      product: { organizationId: input.organizationId },
      status: CatalogEnrichmentProposalStatus.PENDING,
    },
    include: {
      product: {
        include: {
          inventory: true,
        },
      },
    },
  });
  if (!proposal) throw new Error("enrichment_proposal_not_found");

  const proposalImages = strings(proposal.images);
  const selectedImage = input.selectedImageUrl?.trim();
  if (selectedImage && !proposalImages.includes(selectedImage)) {
    throw new Error("selected_image_not_in_proposal");
  }

  const stock = proposal.product.inventory.reduce(
    (sum, item) => sum + item.onHand,
    0,
  );

  const current = masterCardSchema.parse({
    sku: proposal.product.sku,
    barcode: proposal.product.barcode || undefined,
    title: proposal.product.title,
    brand: proposal.product.brand || undefined,
    shortDescription: proposal.product.shortDescription || undefined,
    description: proposal.product.description || undefined,
    application: proposal.product.application || undefined,
    ingredients: proposal.product.ingredients || undefined,
    categoryKey: proposal.product.categoryKey || undefined,
    attributes: record(proposal.product.attributes),
    images: strings(proposal.product.images),
    purchasePrice: proposal.product.purchasePrice ?? undefined,
    price: proposal.product.basePrice ?? undefined,
    stock,
  });

  const proposed = stagingPatchSchema.parse({
    ...(input.includeTitle && proposal.title
      ? { title: proposal.title }
      : {}),
    ...(input.includeBrand
      ? {
          brand:
            record(proposal.facts).extracted &&
            typeof record(record(proposal.facts).extracted).brand === "string"
              ? String(record(record(proposal.facts).extracted).brand)
              : undefined,
        }
      : {}),
    ...(proposal.shortDescription
      ? { shortDescription: proposal.shortDescription }
      : {}),
    ...(proposal.description ? { description: proposal.description } : {}),
    ...(proposal.application ? { application: proposal.application } : {}),
    ...(proposal.ingredients ? { ingredients: proposal.ingredients } : {}),
    ...(selectedImage ? { images: [selectedImage] } : {}),
  });

  return createChangeSet({
    organizationId: input.organizationId,
    productId: proposal.productId,
    sourceType: "AI_ENRICHMENT",
    sourceRef: proposal.id,
    current,
    proposed,
    createdBy: input.createdBy,
  });
}
