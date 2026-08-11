export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import {
  applyProductEnrichmentProposal,
  type ProposalApplyMode,
} from "@/lib/enrichment/applyProposal";

type Params = { params: { id: string } };

const BodySchema = z.object({
  mode: z.enum(["ALL", "DESCRIPTION", "IMAGE"]).default("ALL"),
  imageUrl: z.string().url().max(3000).optional().or(z.literal("")),
  stock: z.number().int().min(0).max(1_000_000).optional(),
});

function errorResponse(error: unknown) {
  const message = String(
    error instanceof Error ? error.message : error || "proposal_apply_failed",
  );

  const status =
    message === "proposal_not_found"
      ? 404
      : message === "proposal_not_pending"
        ? 409
        : message === "proposal_description_empty" ||
            message === "proposal_image_missing" ||
            message === "proposal_image_not_allowed" ||
            message === "product_supplier_required" ||
            message === "proposal_stock_required"
          ? 422
          : 500;

  return NextResponse.json(
    { error: message === "proposal_not_found" ? message : "proposal_apply_failed", message },
    { status },
  );
}

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

  try {
    const result = await applyProductEnrichmentProposal({
      proposalId: params.id,
      mode: parsed.data.mode as ProposalApplyMode,
      imageUrl: parsed.data.imageUrl?.trim() || null,
      stock: parsed.data.stock,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("POST enrichment proposal apply", error);
    return errorResponse(error);
  }
}
