export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import {
  getCatalogImageNormalizationCounts,
  normalizeCatalogImageBatch,
} from "@/lib/catalogImageNormalization";

const BatchSchema = z.object({
  limit: z.number().int().min(1).max(5).optional().default(3),
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

  return NextResponse.json({
    ok: true,
    ...(await normalizeCatalogImageBatch(parsed.data.limit)),
  });
}
