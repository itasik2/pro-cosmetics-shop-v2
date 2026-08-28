export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { rollbackAutopilotDescription } from "@/lib/enrichment/applyProposal";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, props: Params) {
  const params = await props.params;
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    const proposal = await rollbackAutopilotDescription(params.id);
    return NextResponse.json({ proposal });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    const status =
      message === "proposal_not_found"
        ? 404
        : [
              "proposal_not_applied",
              "autopilot_audit_not_found",
              "autopilot_already_rolled_back",
              "product_changed_after_autopilot",
            ].includes(message)
          ? 409
          : 500;
    return NextResponse.json(
      { error: "autopilot_rollback_failed", message },
      { status },
    );
  }
}

