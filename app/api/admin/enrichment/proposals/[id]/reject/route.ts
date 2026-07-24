export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { rejectProductEnrichmentProposal } from "@/lib/enrichment/applyProposal";

type Params = { params: { id: string } };

export async function POST(_req: Request, { params }: Params) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    const proposal = await rejectProductEnrichmentProposal(params.id);
    return NextResponse.json({ proposal });
  } catch (error) {
    const message = String(
      error instanceof Error ? error.message : error || "proposal_reject_failed",
    );
    const status =
      message === "proposal_not_found"
        ? 404
        : message === "proposal_not_pending"
          ? 409
          : 500;

    console.error("POST enrichment proposal reject", error);
    return NextResponse.json(
      {
        error: message === "proposal_not_found" ? message : "proposal_reject_failed",
        message,
      },
      { status },
    );
  }
}
