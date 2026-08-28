export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { ImportRowAction, PriceImportStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import { comparePriceImportDate } from "@/lib/price-import/dateGuard";
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
    .max(1000),
});

async function readImport(id: string) {
  const priceImport = await prisma.priceImport.findUnique({
    where: { id },
    include: {
      supplier: true,
      rows: {
        orderBy: [{ pageNumber: "asc" }, { rowNumber: "asc" }],
      },
    },
  });

  if (!priceImport) return null;

  const dateComparison = await comparePriceImportDate({
    supplierId: priceImport.supplierId,
    sourceDate: priceImport.sourceDate,
    excludeImportId: priceImport.id,
  });

  return { ...priceImport, dateComparison };
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

  await prisma.$transaction(
    parsed.data.rows.map((row) =>
      prisma.priceImportRow.updateMany({
        where: { id: row.id, importId: params.id },
        data: {
          ...(typeof row.selected === "boolean" ? { selected: row.selected } : {}),
          ...(row.action ? { action: row.action } : {}),
        },
      }),
    ),
  );

  const priceImport = await readImport(params.id);
  return NextResponse.json(priceImport);
}

export async function DELETE(_req: Request, props: Params) {
  const params = await props.params;
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const priceImport = await prisma.priceImport.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, fileName: true },
  });

  if (!priceImport) {
    return NextResponse.json({ error: "import_not_found" }, { status: 404 });
  }
  if (priceImport.status === PriceImportStatus.APPLIED) {
    return NextResponse.json(
      {
        error: "applied_import_cannot_be_deleted",
        message: "Применённый импорт хранится как журнал изменений товаров и цен.",
      },
      { status: 409 },
    );
  }

  await prisma.priceImport.delete({ where: { id: priceImport.id } });
  return NextResponse.json({ ok: true, fileName: priceImport.fileName });
}
