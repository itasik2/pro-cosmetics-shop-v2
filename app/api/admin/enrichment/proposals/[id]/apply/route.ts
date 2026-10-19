export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { finalizeProductEnrichmentText } from "@/lib/enrichment/applyProposal";
import {
  applyProductEnrichmentProposalUniversal,
  type ProposalApplyMode,
} from "@/lib/enrichment/applyProposalUniversal";
import { proposalApplySchema } from "@/lib/enrichment/proposalApplyInput";

type Params = { params: Promise<{ id: string }> };

function errorResponse(error: unknown) {
  const message = String(
    error instanceof Error ? error.message : error || "proposal_apply_failed",
  );

  const status =
    message === "proposal_not_found"
      ? 404
      : [
            "variant_sku_changed",
            "product_changed_refresh",
            "proposal_changed_refresh",
          ].includes(message)
        ? 409
        : [
              "variant_image_target_invalid",
              "variant_image_not_allowed",
            ].includes(message)
          ? 422
          : message === "proposal_not_pending"
            ? 409
            : message === "proposal_description_empty" ||
                message === "proposal_short_description_empty" ||
                message === "proposal_match_confidence_zero" ||
                message === "proposal_image_missing" ||
                message === "proposal_image_not_allowed" ||
                message === "product_supplier_required" ||
                message === "variant_stock_invalid"
              ? 422
              : 500;

  const explanations: Record<string, string> = {
    proposal_image_not_allowed:
      "Выбранное общее фото больше не соответствует карточке. Повторите подбор фото по SKU.",
    proposal_short_description_empty:
      "Добавьте краткое описание товара перед применением карточки.",
    proposal_description_empty:
      "Добавьте описание товара перед применением карточки.",
    variant_sku_changed:
      "SKU варианта изменился. Обновите карточку и повторите поиск фото.",
    variant_image_not_allowed:
      "Это фото не подтверждено для выбранного SKU. Повторите поиск и выберите фото своего варианта.",
    variant_image_target_invalid:
      "Состав вариантов изменился. Обновите карточку.",
    product_changed_refresh:
      "Товар изменился во время сохранения. Обновите карточку и проверьте фото.",
    proposal_changed_refresh:
      "Предложение изменилось. Обновите его перед применением.",
  };
  return NextResponse.json(
    {
      error:
        message === "proposal_not_found" ? message : "proposal_apply_failed",
      message: explanations[message] || message,
    },
    { status },
  );
}

export async function POST(req: Request, props: Params) {
  const params = await props.params;
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const parsed = proposalApplySchema.safeParse(
    await req.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "validation",
        message:
          "Не удалось применить данные: проверьте выбранные фото и остатки вариантов.",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.mode === "DESCRIPTION_FINAL") {
      const proposal = await finalizeProductEnrichmentText({
        proposalId: params.id,
        appliedBy: "ADMIN",
      });
      return NextResponse.json({ proposal, importedImage: null });
    }

    const result = await applyProductEnrichmentProposalUniversal({
      proposalId: params.id,
      mode: parsed.data.mode as ProposalApplyMode,
      imageUrl: parsed.data.imageUrl?.trim() || null,
      stock: parsed.data.stock,
      variantStocks: parsed.data.variantStocks,
      variantImages: parsed.data.variantImages,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("POST enrichment proposal apply", error);
    return errorResponse(error);
  }
}
