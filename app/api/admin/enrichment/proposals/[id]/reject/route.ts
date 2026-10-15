export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { rejectProductEnrichmentProposal } from "@/lib/enrichment/applyProposal";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, props: Params) {
  const params = await props.params;
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    const proposal = await rejectProductEnrichmentProposal(params.id);
    return NextResponse.json({ proposal });
  } catch (error) {
    const message = String(
      error instanceof Error
        ? error.message
        : error || "proposal_reject_failed",
    );
    const status =
      message === "proposal_not_found"
        ? 404
        : ["proposal_not_pending", "proposal_changed_refresh"].includes(message)
          ? 409
          : 500;

    console.error("POST enrichment proposal reject", error);
    return NextResponse.json(
      {
        error:
          message === "proposal_not_found" ? message : "proposal_reject_failed",
        message:
          message === "proposal_not_pending"
            ? "Предложение уже обработано. Обновите страницу."
            : message === "proposal_changed_refresh"
              ? "Предложение изменилось. Повторите отклонение."
              : message === "proposal_not_found"
                ? "Предложение не найдено."
                : "Не удалось отклонить предложение. Повторите попытку.",
      },
      { status },
    );
  }
}
