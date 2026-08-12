import { createHash } from "node:crypto";
import {
  EnrichmentJobStatus,
  EnrichmentProposalStatus,
  ProductSourceStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { safeFetchHtml } from "./network";
import {
  findSourceForUrl,
  getEnabledSupplierSources,
  toAllowedPolicies,
} from "./sourcePolicies";
import { runProductEnrichment } from "./runProductEnrichment";

export type ProductSourceMonitorResult = {
  sourceId: string;
  productId: string;
  status: "UNCHANGED" | "CHANGED" | "SKIPPED" | "FAILED";
  proposalId?: string | null;
  reason?: string;
};

function messageOf(error: unknown) {
  return String(
    error && typeof error === "object" && "message" in error
      ? (error as { message?: unknown }).message
      : error || "source_monitor_failed",
  ).slice(0, 1000);
}

export async function monitorProductSource(
  sourceId: string,
): Promise<ProductSourceMonitorResult> {
  const source = await prisma.productSource.findUnique({
    where: { id: sourceId },
    include: {
      product: {
        select: {
          id: true,
          supplierId: true,
        },
      },
      supplierSource: {
        select: {
          id: true,
          isEnabled: true,
        },
      },
    },
  });

  if (!source) throw new Error("product_source_not_found");

  const base = {
    sourceId: source.id,
    productId: source.productId,
  };

  if (!source.product.supplierId) {
    return { ...base, status: "SKIPPED", reason: "product_supplier_required" };
  }

  if (source.supplierSource && !source.supplierSource.isEnabled) {
    await prisma.productSource.update({
      where: { id: source.id },
      data: {
        status: ProductSourceStatus.BLOCKED,
        error: "supplier_source_disabled",
      },
    });
    return { ...base, status: "SKIPPED", reason: "supplier_source_disabled" };
  }

  const [pendingProposal, activeJob] = await Promise.all([
    prisma.productEnrichmentProposal.findFirst({
      where: {
        productId: source.productId,
        status: EnrichmentProposalStatus.PENDING,
        confidence: { gt: 0 },
      },
      select: { id: true },
    }),
    prisma.enrichmentJob.findFirst({
      where: {
        productId: source.productId,
        status: {
          in: [EnrichmentJobStatus.PENDING, EnrichmentJobStatus.RUNNING],
        },
      },
      select: { id: true },
    }),
  ]);

  if (pendingProposal || activeJob) {
    return {
      ...base,
      status: "SKIPPED",
      reason: pendingProposal ? "pending_proposal_exists" : "job_already_running",
    };
  }

  const allowedSources = await getEnabledSupplierSources(source.product.supplierId);
  const allowedSource = findSourceForUrl(allowedSources, source.url);
  if (!allowedSource) {
    await prisma.productSource.update({
      where: { id: source.id },
      data: {
        status: ProductSourceStatus.BLOCKED,
        error: "source_domain_not_allowed",
        lastCheckedAt: new Date(),
      },
    });
    return { ...base, status: "SKIPPED", reason: "source_domain_not_allowed" };
  }

  try {
    const fetched = await safeFetchHtml(source.url, toAllowedPolicies(allowedSources));
    const contentHash = createHash("sha256").update(fetched.buffer).digest("hex");

    if (source.contentHash === contentHash) {
      await prisma.productSource.update({
        where: { id: source.id },
        data: {
          lastCheckedAt: new Date(),
          status: ProductSourceStatus.ACTIVE,
          httpStatus: fetched.status,
          error: null,
        },
      });

      return { ...base, status: "UNCHANGED" };
    }

    const proposal = await runProductEnrichment({
      productId: source.productId,
      sourceUrl: fetched.finalUrl,
      discoverIfMissing: false,
    });

    return {
      ...base,
      status: "CHANGED",
      proposalId: proposal?.id ?? null,
    };
  } catch (error) {
    const message = messageOf(error);
    await prisma.productSource
      .update({
        where: { id: source.id },
        data: {
          lastCheckedAt: new Date(),
          status: ProductSourceStatus.ERROR,
          error: message,
        },
      })
      .catch(() => undefined);

    return { ...base, status: "FAILED", reason: message };
  }
}

export async function monitorStaleProductSources(input?: {
  limit?: number;
  staleHours?: number;
}) {
  const limit = Math.min(8, Math.max(1, Math.trunc(input?.limit || 4)));
  const staleHours = Math.min(
    24 * 90,
    Math.max(1, Math.trunc(input?.staleHours || 24 * 7)),
  );
  const staleBefore = new Date(Date.now() - staleHours * 60 * 60 * 1000);

  const sources = await prisma.productSource.findMany({
    where: {
      status: { in: [ProductSourceStatus.ACTIVE, ProductSourceStatus.ERROR] },
      supplierSource: { isEnabled: true },
      OR: [
        { lastCheckedAt: null },
        { lastCheckedAt: { lt: staleBefore } },
      ],
    },
    orderBy: [{ lastCheckedAt: "asc" }, { createdAt: "asc" }],
    take: limit,
    select: { id: true },
  });

  const results: ProductSourceMonitorResult[] = [];
  for (const source of sources) {
    results.push(await monitorProductSource(source.id));
  }

  return {
    checked: results.length,
    unchanged: results.filter((item) => item.status === "UNCHANGED").length,
    changed: results.filter((item) => item.status === "CHANGED").length,
    skipped: results.filter((item) => item.status === "SKIPPED").length,
    failed: results.filter((item) => item.status === "FAILED").length,
    results,
  };
}
