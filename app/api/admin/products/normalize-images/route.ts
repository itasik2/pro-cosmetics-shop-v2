export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import {
  getCatalogImageNormalizationCounts,
  normalizeCatalogImageBatch,
  resetNeedsReviewAttempts,
} from "@/lib/catalogImageNormalization";

const BatchSchema = z.object({
  limit: z.number().int().min(1).max(5).optional().default(5),
  resetNeedsReview: z.boolean().optional().default(false),
});

export async function GET() {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  return NextResponse.json(await getCatalogImageNormalizationCounts());
}

export async function POST(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const parsed = BatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const reset = parsed.data.resetNeedsReview
    ? await resetNeedsReviewAttempts()
    : 0;

  return NextResponse.json({
    ok: true,
    reset,
    ...(await normalizeCatalogImageBatch(parsed.data.limit)),
  });
}
