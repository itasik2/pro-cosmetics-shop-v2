export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const imports = await prisma.priceImport.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      supplier: true,
      _count: { select: { rows: true } },
    },
  });

  return NextResponse.json(imports);
}
