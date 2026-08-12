export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { EnrichmentProposalStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";

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

  const proposals = await prisma.productEnrichmentProposal.findMany({
    where: { status, confidence: { gt: 0 } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      product: {
        select: {
          id: true,
          name: true,
          supplierSku: true,
          image: true,
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
          lastCheckedAt: true,
          lastChangedAt: true,
          status: true,
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

  return NextResponse.json(proposals);
}
