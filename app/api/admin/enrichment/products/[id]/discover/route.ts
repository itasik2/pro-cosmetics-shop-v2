export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import {
  EnrichmentJobStatus,
  EnrichmentProposalStatus,
} from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import { runProductEnrichment } from "@/lib/enrichment/runProductEnrichment";
import { prisma } from "@/lib/prisma";

type Params = { params: { id: string } };

const BodySchema = z.object({
  sourceUrl: z.string().url().max(2000).optional().or(z.literal("")),
  discoverIfMissing: z.boolean().optional().default(true),
});

export async function POST(req: Request, { params }: Params) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const product = await prisma.product.findUnique({
    where: { id: params.id },
    select: { id: true, supplierId: true },
  });
  if (!product) {
    return NextResponse.json({ error: "product_not_found" }, { status: 404 });
  }
  if (!product.supplierId) {
    return NextResponse.json(
      { error: "product_supplier_required" },
      { status: 409 },
    );
  }

  const pendingProposal = await prisma.productEnrichmentProposal.findFirst({
    where: {
      productId: product.id,
      status: EnrichmentProposalStatus.PENDING,
      confidence: { gt: 0 },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });
  if (pendingProposal) {
    return NextResponse.json(
      { error: "enrichment_proposal_exists", proposal: pendingProposal },
      { status: 409 },
    );
  }

  const runningJob = await prisma.enrichmentJob.findFirst({
    where: {
      productId: product.id,
      status: {
        in: [EnrichmentJobStatus.PENDING, EnrichmentJobStatus.RUNNING],
      },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, createdAt: true },
  });

  if (runningJob) {
    return NextResponse.json(
      { error: "enrichment_already_running", job: runningJob },
      { status: 409 },
    );
  }

  try {
    const proposal = await runProductEnrichment({
      productId: product.id,
      sourceUrl: parsed.data.sourceUrl?.trim() || null,
      discoverIfMissing: parsed.data.discoverIfMissing,
    });

    return NextResponse.json({ proposal }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "enrichment_failed",
        message: String(error?.message || error),
      },
      { status: 422 },
    );
  }
}
