export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { prepareProposalPhotos } from "@/lib/enrichment/prepareProposalPhotos";
import { z } from "zod";

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> },
) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  const { id } = await props.params;
  const body = z.object({ resume: z.boolean().optional() }).safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  try {
    return NextResponse.json(await prepareProposalPhotos(id, { resume: body.data.resume }));
  } catch (error) {
    const code = error instanceof Error ? error.message : "photo_search_failed";
    return NextResponse.json(
      {
        error: code,
        message: /changed|not_pending/.test(code)
          ? "Карточка изменилась. Обновите список и повторите поиск."
          : "Подбор фото не завершён. Ранее найденные фото сохранены.",
      },
      { status: /changed|not_pending/.test(code) ? 409 : 500 },
    );
  }
}
