export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { ImportRowAction } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";

type Params = { params: { id: string } };

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
  return prisma.priceImport.findUnique({
    where: { id },
    include: {
      supplier: true,
      rows: {
        orderBy: [{ pageNumber: "asc" }, { rowNumber: "asc" }],
      },
    },
  });
}

export async function GET(_req: Request, { params }: Params) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const priceImport = await readImport(params.id);
  if (!priceImport) {
    return NextResponse.json({ error: "import_not_found" }, { status: 404 });
  }

  return NextResponse.json(priceImport);
}

export async function PATCH(req: Request, { params }: Params) {
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
