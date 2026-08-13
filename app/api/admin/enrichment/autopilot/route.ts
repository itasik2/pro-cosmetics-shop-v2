export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { EnrichmentProposalStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";
import { runCatalogAutopilot } from "@/lib/enrichment/catalogAutopilot";
import { getCatalogAutopilotConfig } from "@/lib/enrichment/catalogAutopilotPolicy";

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function overview() {
  const config = getCatalogAutopilotConfig();
  const [pendingProposals, pendingDiscovery, sourceRequired, appliedRows] =
    await Promise.all([
      prisma.productEnrichmentProposal.count({
        where: {
          status: EnrichmentProposalStatus.PENDING,
          confidence: { gt: 0 },
        },
      }),
      prisma.product.count({
        where: {
          supplierId: { not: null },
          enrichmentStatus: "PENDING",
          enrichmentProposals: {
            none: {
              status: EnrichmentProposalStatus.PENDING,
              confidence: { gt: 0 },
            },
          },
        },
      }),
      prisma.product.count({
        where: { enrichmentStatus: "SOURCE_REQUIRED" },
      }),
      prisma.productEnrichmentProposal.findMany({
        where: { status: EnrichmentProposalStatus.APPLIED },
        orderBy: { appliedAt: "desc" },
        take: 50,
        select: {
          id: true,
          appliedAt: true,
          sourceUrl: true,
          confidence: true,
          facts: true,
          product: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
        },
      }),
    ]);

  const recentChanges = appliedRows
    .map((row) => {
      const audit = jsonObject(jsonObject(row.facts).catalogAutopilot);
      if (audit.appliedBy !== "AUTOPILOT" || audit.rolledBackAt) return null;
      return {
        id: row.id,
        appliedAt: row.appliedAt,
        sourceUrl: row.sourceUrl,
        confidence: row.confidence,
        product: row.product,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .slice(0, 10);

  return {
    config,
    counts: {
      pendingProposals,
      pendingDiscovery,
      sourceRequired,
      recentAutomaticChanges: recentChanges.length,
    },
    recentChanges,
  };
}

export async function GET() {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  return NextResponse.json(await overview());
}

export async function POST() {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    const result = await runCatalogAutopilot();
    return NextResponse.json({ result, overview: await overview() });
  } catch (error) {
    console.error("POST catalog autopilot", error);
    return NextResponse.json(
      {
        error: "catalog_autopilot_failed",
        message: String(error instanceof Error ? error.message : error),
      },
      { status: 500 },
    );
  }
}
