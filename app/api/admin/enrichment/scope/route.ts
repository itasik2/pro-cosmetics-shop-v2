export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { PriceImportStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import { ENRICHMENT_PRICE_IMPORT_COOKIE } from "@/lib/enrichment/priceImportScope";
import { prisma } from "@/lib/prisma";

const BodySchema = z.object({
  importId: z.string().min(1).max(200),
});

function setScopeCookie(response: NextResponse, value: string) {
  response.cookies.set(ENRICHMENT_PRICE_IMPORT_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

export async function GET(req: NextRequest) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const imports = await prisma.priceImport.findMany({
    where: { status: { in: [PriceImportStatus.APPLIED, PriceImportStatus.REVIEW] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: {
      id: true,
      fileName: true,
      status: true,
      rows: { where: { appliedAt: { not: null } }, take: 1, select: { id: true } },
      sourceDate: true,
      appliedAt: true,
      createdAt: true,
      totalRows: true,
      createdRows: true,
      updatedRows: true,
      supplier: { select: { id: true, name: true } },
    },
  });

  const options = imports.map(({ status, rows, ...item }) => ({
    ...item,
    readyForPhotos: rows.length > 0 ||
      (status === PriceImportStatus.APPLIED && item.createdRows + item.updatedRows > 0),
  }));
  const requested = new URL(req.url).searchParams.get("importId");
  const stored = req.cookies.get(ENRICHMENT_PRICE_IMPORT_COOKIE)?.value;
  const validIds = new Set(options.map((item) => item.id));
  const selectedImportId =
    requested && validIds.has(requested) ? requested
      : stored === "ALL" || (stored && validIds.has(stored)) ? stored
      : options.find((item) => item.readyForPhotos)?.id || options[0]?.id || "ALL";

  const response = NextResponse.json({ selectedImportId, imports: options });
  return setScopeCookie(response, selectedImportId);
}

export async function POST(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const importId = parsed.data.importId;
  if (importId !== "ALL") {
    const exists = await prisma.priceImport.findFirst({
      where: {
        id: importId,
        status: { in: [PriceImportStatus.APPLIED, PriceImportStatus.REVIEW] },
      },
      select: { id: true },
    });
    if (!exists) {
      return NextResponse.json(
        { error: "price_import_not_found" },
        { status: 404 },
      );
    }
  }

  return setScopeCookie(NextResponse.json({ ok: true, importId }), importId);
}
