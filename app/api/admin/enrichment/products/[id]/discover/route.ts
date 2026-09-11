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
import { sleep } from "@/lib/enrichment/openaiRetry";
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
  if (/^openai_http_429:/.test(message)) {
    return "OpenAI временно достиг лимита запросов. Автоматические повторы исчерпаны; повторите поиск через несколько секунд.";
  }
  return message;
}

function retryableOpenAiError(message: string) {
  return /^openai_http_(?:429|500|502|503|504):/.test(message);
}

function retryDelayFromMessage(message: string, attempt: number) {
  const match = message.match(/try again in\s+(\d+(?:\.\d+)?)\s*(ms|s)/i);
  if (match) {
    const value = Number(match[1]);
    const milliseconds = match[2].toLowerCase() === "s" ? value * 1000 : value;
    if (Number.isFinite(milliseconds)) {
      return Math.min(5_000, Math.max(300, Math.ceil(milliseconds) + 100));
    }
  }
  return Math.min(5_000, 500 * 2 ** attempt + Math.floor(Math.random() * 250));
}

async function runWithOpenAiRetry(input: {
  productId: string;
  sourceUrl: string | null;
  discoverIfMissing: boolean;
}) {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await runProductEnrichment(input);
    } catch (error: any) {
      lastError = error;
      const message = String(error?.message || error);
      if (!retryableOpenAiError(message) || attempt >= maxAttempts - 1) {
        throw error;
      }
      await sleep(retryDelayFromMessage(message, attempt));
    }
  }

  throw lastError;
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
    const proposal = await runWithOpenAiRetry({
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
