export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import { applyPriceImport } from "@/lib/price-import/applyImport";

const BodySchema = z.object({
  automatic: z.boolean().default(false),
  approvedDecreases: z
    .array(
      z.object({
        rowId: z.string().min(1),
        previousPrice: z.number().int().nonnegative(),
        nextPrice: z.number().int().nonnegative(),
      }),
    )
    .max(1000)
    .default([]),
});

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> },
) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  const body = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success)
    return NextResponse.json({ error: "validation" }, { status: 400 });
  try {
    return NextResponse.json(
      await applyPriceImport({
        importId: (await props.params).id,
        ...body.data,
      }),
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "price_import_failed";
    const messages: Record<string, string> = {
      price_import_date_required:
        "Укажите дату прайса. Без неё нельзя определить свежесть цен.",
      price_import_older:
        "У поставщика уже есть более свежий прайс. Цены этого файла не применены.",
      price_import_future:
        "Дата прайса ещё не наступила. Применение цен пока недоступно.",
      import_not_found: "Импорт не найден.",
    };
    return NextResponse.json(
      {
        error: code,
        message:
          messages[code] ||
          "Не удалось применить прайс. Откройте его повторно и проверьте результат.",
      },
      {
        status: code === "import_not_found" ? 404 : messages[code] ? 409 : 500,
      },
    );
  }
}
