export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { EnrichmentProposalStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { getEnrichmentPriceImportId } from "@/lib/enrichment/priceImportScope";
import { priceListImagesForProducts } from "@/lib/enrichment/priceListImages";
import { prisma } from "@/lib/prisma";

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export async function GET(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const url = new URL(req.url);
  const statusValue = (url.searchParams.get("status") || "PENDING").toUpperCase();
  const status = Object.values(EnrichmentProposalStatus).includes(
    statusValue as EnrichmentProposalStatus,
  )
    ? (statusValue as EnrichmentProposalStatus)
    : EnrichmentProposalStatus.PENDING;
  const priceImportId = getEnrichmentPriceImportId();

  const proposals = await prisma.productEnrichmentProposal.findMany({
    where: {
      status,
      confidence: { gt: 0 },
      ...(priceImportId
        ? {
            product: {
              importRows: { some: { importId: priceImportId } },
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      product: {
        select: {
          id: true,
          name: true,
          supplierSku: true,
          image: true,
          shortDescription: true,
          description: true,
          stock: true,
          variants: true,
          isPublished: true,
          enrichmentStatus: true,
          brand: { select: { name: true } },
          supplier: { select: { id: true, name: true, slug: true } },
        },
      },
      source: {
        select: {
          id: true,
          url: true,
          canonicalUrl: true,
          title: true,
          sourceType: true,
          lastCheckedAt: true,
          lastChangedAt: true,
          status: true,
          supplierSource: {
            select: {
              domain: true,
              sourceType: true,
              isEnabled: true,
            },
          },
        },
      },
      job: {
        select: {
          id: true,
          status: true,
          error: true,
          createdAt: true,
          finishedAt: true,
        },
      },
    },
  });

  const priceImages = await priceListImagesForProducts(
    proposals.map((proposal) => proposal.productId),
    priceImportId,
  );

  const enriched = proposals.map((proposal) => {
    const priceImage = priceImages.get(proposal.productId);
    if (!priceImage) return proposal;

    const images = [
      ...new Set([priceImage.url, ...stringArray(proposal.images)]),
    ].slice(0, 12);
    const facts = jsonObject(proposal.facts);

    return {
      ...proposal,
      images,
      facts: {
        ...facts,
        priceImageUrl: priceImage.url,
        priceImageImport: {
          importId: priceImage.importId,
          fileName: priceImage.fileName,
          rowNumber: priceImage.rowNumber,
        },
        imageCandidates: images.map((candidateUrl) => ({
          url: candidateUrl,
          source: candidateUrl === priceImage.url ? "PRICE_LIST" : "WEB",
        })),
      },
    };
  });

  return NextResponse.json(enriched);
}
