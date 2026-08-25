export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { PriceImportStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import {
  ENRICHMENT_PRICE_IMPORT_COOKIE,
} from "@/lib/enrichment/priceImportScope";
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

export async function GET(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const imports = await prisma.priceImport.findMany({
    where: { status: PriceImportStatus.APPLIED },
    orderBy: [{ appliedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: {
      id: true,
      fileName: true,
      sourceDate: true,
      appliedAt: true,
      createdAt: true,
      totalRows: true,
      createdRows: true,
      updatedRows: true,
      supplier: { select: { id: true, name: true } },
    },
  });

  const cookieHeader = req.headers.get("cookie") || "";
  const cookieMatch = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${ENRICHMENT_PRICE_IMPORT_COOKIE}=([^;]+)`),
  );
  const stored = cookieMatch ? decodeURIComponent(cookieMatch[1]) : "";
  const validIds = new Set(imports.map((item) => item.id));
  const selectedImportId =
    stored === "ALL"
      ? "ALL"
      : stored && validIds.has(stored)
        ? stored
        : imports[0]?.id || "ALL";

  const response = NextResponse.json({ selectedImportId, imports });
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
      where: { id: importId, status: PriceImportStatus.APPLIED },
      select: { id: true },
    });
    if (!exists) {
      return NextResponse.json({ error: "price_import_not_found" }, { status: 404 });
    }
  }

  return setScopeCookie(NextResponse.json({ ok: true, importId }), importId);
}
