export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { EnrichmentProposalStatus, type Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const url = new URL(req.url);
  const query = (url.searchParams.get("q") || "").trim();
  const status = (url.searchParams.get("status") || "").trim().toUpperCase();

  const statusFilter: Prisma.ProductWhereInput =
    status === "SOURCE_REQUIRED"
      ? {
          OR: [
            { enrichmentStatus: "SOURCE_REQUIRED" },
            {
              enrichmentStatus: "FAILED",
              enrichmentJobs: {
                some: {
                  error: {
                    in: [
                      "official_page_not_found",
                      "official_page_not_found_after_stale_source",
                    ],
                  },
                },
              },
            },
          ],
        }
      : status && status !== "ALL"
        ? { enrichmentStatus: status }
        : {};

  const queryFilter: Prisma.ProductWhereInput = query
    ? {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { supplierSku: { contains: query, mode: "insensitive" } },
          { brand: { name: { contains: query, mode: "insensitive" } } },
          { supplier: { name: { contains: query, mode: "insensitive" } } },
        ],
      }
    : {};

  const products = await prisma.product.findMany({
    where: {
      supplierId: { not: null },
      AND: [statusFilter, queryFilter],
    },
    orderBy: [{ enrichmentStatus: "asc" }, { updatedAt: "desc" }],
    take: 150,
    include: {
      brand: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true, slug: true } },
      sources: {
        orderBy: { lastCheckedAt: "desc" },
        take: 1,
        select: {
          id: true,
          url: true,
          title: true,
          status: true,
          lastCheckedAt: true,
          lastChangedAt: true,
        },
      },
      enrichmentJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          error: true,
          sourceUrl: true,
          createdAt: true,
          finishedAt: true,
        },
      },
      enrichmentProposals: {
        where: { status: EnrichmentProposalStatus.PENDING },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          confidence: true,
          sourceUrl: true,
          createdAt: true,
        },
      },
    },
  });

  return NextResponse.json(products);
}
