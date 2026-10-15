export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import { editProposalText } from "@/lib/enrichment/editProposal";

const Body = z
  .object({
    version: z.string().regex(/^[a-f0-9]{64}$/),
    title: z.string().trim().min(2).max(500),
    shortDescription: z.string().trim().max(280),
    description: z.string().trim().max(30000),
    application: z.string().trim().max(12000),
    ingredients: z.string().trim().max(16000),
  })
  .strict();

export async function PATCH(
  req: Request,
  props: { params: Promise<{ id: string }> },
) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      {
        error: "validation",
        message:
          "Проверьте текст: название — до 500 символов, краткое описание — до 280.",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  const { id } = await props.params;
  const { version, ...text } = parsed.data;
  try {
    const proposal = await editProposalText({ proposalId: id, version, text });
    return NextResponse.json({ proposal });
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "proposal_edit_failed";
    const messages: Record<string, string> = {
      proposal_not_found: "Предложение не найдено.",
      proposal_not_pending: "Предложение уже обработано. Обновите страницу.",
      proposal_text_changed:
        "Текст изменился в другом окне. Обновите страницу перед сохранением.",
      proposal_changed_refresh:
        "Предложение обновилось во время сохранения. Повторите сохранение текста.",
      proposal_title_empty: "Укажите название товара без рекламных приписок.",
    };
    return NextResponse.json(
      {
        error: code in messages ? code : "proposal_edit_failed",
        message:
          messages[code] || "Не удалось сохранить текст. Повторите попытку.",
      },
      {
        status:
          code === "proposal_not_found"
            ? 404
            : /not_pending|changed/.test(code)
              ? 409
              : code === "proposal_title_empty"
                ? 422
                : 500,
      },
    );
  }
}
