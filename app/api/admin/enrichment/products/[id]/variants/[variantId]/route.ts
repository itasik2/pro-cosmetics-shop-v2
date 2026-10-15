export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import { removeProposalVariant } from "@/lib/enrichment/removeProposalVariant";

const Body = z.object({
  proposalId: z.string().min(1).max(150),
  sku: z.string().max(150),
});
export async function DELETE(
  req: Request,
  props: { params: Promise<{ id: string; variantId: string }> },
) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success)
    return NextResponse.json({ error: "validation" }, { status: 400 });
  const { id, variantId } = await props.params;
  try {
    return NextResponse.json(
      await removeProposalVariant({ productId: id, variantId, ...body.data }),
    );
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "variant_delete_failed";
    const messages: Record<string, string> = {
      last_variant_requires_reject:
        "Последний вариант нельзя удалить. Отклоните предложение товара целиком.",
      variant_sku_changed: "Вариант изменился. Обновите карточку.",
      proposal_not_pending: "Предложение уже обработано. Обновите список.",
      product_changed_refresh:
        "Товар изменился. Обновите карточку и повторите удаление.",
      proposal_changed_refresh:
        "Предложение изменилось. Обновите карточку и повторите удаление.",
    };
    return NextResponse.json(
      { error: code, message: messages[code] || "Не удалось удалить вариант." },
      {
        status:
          code === "product_not_found"
            ? 404
            : code === "last_variant_requires_reject"
              ? 422
              : /changed|not_pending/.test(code)
                ? 409
                : 500,
      },
    );
  }
}
