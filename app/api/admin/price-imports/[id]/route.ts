export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { ImportRowAction, PriceImportStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import { applyPriceImport } from "@/lib/price-import/applyImport";
import {
  preparePriceImport,
  readPriceImport,
} from "@/lib/price-import/reconciliation";
import { sourceDay } from "@/lib/price-import/reconciliationPolicy";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

const RowPatchSchema = z.object({
  rows: z
    .array(
      z.object({
        id: z.string().min(1),
        selected: z.boolean().optional(),
        action: z.nativeEnum(ImportRowAction).optional(),
      }),
    )
    .max(1000)
    .default([]),
  sourceDate: z
    .string()
    .refine((value) => Boolean(sourceDay(value)))
    .optional(),
});

async function readImport(id: string) {
  return readPriceImport(id);
}

export async function GET(_req: Request, props: Params) {
  const params = await props.params;
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const priceImport = await readImport(params.id);
  if (!priceImport) {
    return NextResponse.json({ error: "import_not_found" }, { status: 404 });
  }

  return NextResponse.json(priceImport);
}

export async function PATCH(req: Request, props: Params) {
  const params = await props.params;
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const parsed = RowPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const current = await prisma.priceImport.findUnique({
    where: { id: params.id },
    include: { rows: true },
  });
  if (!current)
    return NextResponse.json({ error: "import_not_found" }, { status: 404 });
  if (current.status !== PriceImportStatus.REVIEW)
    return NextResponse.json(
      {
        error: "import_not_editable",
        message: "Изменять можно только импорт на проверке.",
      },
      { status: 409 },
    );
  if (parsed.data.sourceDate && current.rows.some((row) => row.appliedAt))
    return NextResponse.json(
      {
        error: "price_import_date_locked",
        message:
          "Часть цен уже применена. Для другой даты загрузите отдельный прайс.",
      },
      { status: 409 },
    );

  const patches = new Map<
    string,
    { ids: string[]; data: { selected?: boolean; action?: ImportRowAction } }
  >();
  for (const row of parsed.data.rows) {
    const data = {
      ...(typeof row.selected === "boolean" ? { selected: row.selected } : {}),
      ...(row.action ? { action: row.action } : {}),
    };
    const key = JSON.stringify(data);
    const group = patches.get(key) || { ids: [], data };
    group.ids.push(row.id);
    patches.set(key, group);
  }
  await prisma.$transaction(
    [...patches.values()].map(({ ids, data }) =>
      prisma.priceImportRow.updateMany({
        where: { id: { in: ids }, importId: params.id, appliedAt: null },
        data,
      }),
    ),
  );

  if (parsed.data.sourceDate) {
    const date = sourceDay(parsed.data.sourceDate)!;
    try {
      await prisma.$transaction(
        async (tx) => {
          const applied = await tx.priceImportRow.count({
            where: { importId: params.id, appliedAt: { not: null } },
          });
          if (applied) throw new Error("price_import_date_locked");
          await tx.priceImport.update({
            where: { id: params.id },
            data: { sourceDate: date },
          });
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (
        (error as { code?: string }).code === "P2034" ||
        (error as Error).message === "price_import_date_locked"
      )
        return NextResponse.json(
          {
            error: "price_import_date_locked",
            message:
              "Импорт изменился во время проверки даты. Откройте его повторно.",
          },
          { status: 409 },
        );
      throw error;
    }
    await preparePriceImport(params.id);
    try {
      await applyPriceImport({ importId: params.id, automatic: true });
    } catch {
      /* Date warnings are returned in the review. */
    }
  }

  const priceImport = await readImport(params.id);
  return NextResponse.json(priceImport);
}

export async function DELETE(_req: Request, props: Params) {
  const params = await props.params;
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const priceImport = await prisma.priceImport.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      fileName: true,
      rows: {
        where: { appliedAt: { not: null } },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!priceImport) {
    return NextResponse.json({ error: "import_not_found" }, { status: 404 });
  }
  if (
    priceImport.status === PriceImportStatus.APPLIED ||
    priceImport.rows.length > 0
  ) {
    return NextResponse.json(
      {
        error: "applied_import_cannot_be_deleted",
        message:
          "Применённый импорт хранится как журнал изменений товаров и цен.",
      },
      { status: 409 },
    );
  }

  const removed = await prisma.priceImport.deleteMany({
    where: {
      id: priceImport.id,
      status: { not: "APPLIED" },
      rows: { none: { appliedAt: { not: null } } },
    },
  });
  if (!removed.count)
    return NextResponse.json(
      {
        error: "import_changed",
        message: "В импорте уже применены строки. Журнал цен сохранён.",
      },
      { status: 409 },
    );
  return NextResponse.json({ ok: true, fileName: priceImport.fileName });
}
