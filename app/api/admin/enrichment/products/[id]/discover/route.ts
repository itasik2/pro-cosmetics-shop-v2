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

type Params = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  sourceUrl: z.string().url().max(2000).optional().or(z.literal("")),
  discoverIfMissing: z.boolean().optional().default(true),
});

function userMessage(message: string) {
  if (message === "product_match_zero_confidence") {
    return "Найденная страница не совпадает с этим товаром, поэтому она отброшена. Проверьте название, бренд и объём или укажите точный URL карточки товара.";
  }
  if (message === "product_page_not_found") {
    return "Точная карточка товара не найдена ни на официальном сайте, ни у проверяемых продавцов. Можно указать точный URL вручную.";
  }
  return message;
}

export async function POST(req: Request, props: Params) {
  const params = await props.params;
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
    const message = String(error?.message || error);
    return NextResponse.json(
      {
        error: "enrichment_failed",
        message: userMessage(message),
        code: message,
      },
      { status: 422 },
    );
  }
}
