import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { getCatalogHubShadowConfig, getCatalogHubSnapshot } from "@/lib/catalogHubClient";
import { auditCatalogHubPilot, PILOT_AUDIT_LIMIT } from "@/lib/catalogHubPilotAudit";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const headers = { "Cache-Control": "private, no-store" };

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers });
}

export async function GET(request: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const config = getCatalogHubShadowConfig();
  if (!config.enabled || !config.configured) {
    return errorResponse("catalog_hub_shadow_not_configured", 503);
  }
  const params = new URL(request.url).searchParams;
  const offset = Number(params.get("offset") ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > PILOT_AUDIT_LIMIT) {
    return errorResponse("catalog_hub_pilot_invalid_offset", 400);
  }

  try {
    const [local, snapshot] = await Promise.all([
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const products = await tx.product.findMany({
          where: { isPublished: true, enrichmentStatus: { not: "MERGED" } },
          orderBy: { id: "asc" },
          take: PILOT_AUDIT_LIMIT + 1,
          select: {
            id: true, name: true, supplierSku: true, barcode: true, price: true,
            stock: true, variants: true, brand: { select: { name: true } },
          },
        });
        const counts = await tx.order.groupBy({ by: ["status"], _count: { _all: true } });
        const orderLines = await tx.orderItem.findMany({
          orderBy: { id: "asc" },
          take: PILOT_AUDIT_LIMIT + 1,
          select: {
            orderId: true, productId: true, variantId: true, sku: true, qty: true,
            order: { select: { status: true } },
          },
        });
        return {
          products: products.map(({ brand, ...product }) => ({ ...product, brand: brand?.name ?? null })),
          ordersByStatus: counts.map(row => ({ status: row.status, count: row._count._all })),
          orderLines: orderLines.map(({ order, ...line }) => ({ ...line, status: order.status })),
        };
      }, { isolationLevel: "RepeatableRead", timeout: 12_000 }),
      getCatalogHubSnapshot(),
    ]);
    if (!Array.isArray(snapshot?.items) || snapshot.total !== snapshot.items.length) {
      return errorResponse("catalog_hub_snapshot_incomplete", 502);
    }
    const audit = auditCatalogHubPilot({ ...local, hubProducts: snapshot.items });
    const rows = params.get("all") === "1"
      ? audit.comparisons
      : audit.comparisons.filter(row => row.status !== "MATCH");
    return NextResponse.json({
      summary: audit.summary,
      comparisons: rows.slice(offset, offset + PAGE_SIZE),
      orderIssues: audit.orderIssues,
      page: { offset, total: rows.length, nextOffset: offset + PAGE_SIZE < rows.length ? offset + PAGE_SIZE : null },
      checkedAt: new Date().toISOString(),
    }, { headers });
  } catch (error) {
    if (error instanceof Error && error.message === "catalog_hub_pilot_limit") {
      return errorResponse("catalog_hub_pilot_limit", 422);
    }
    return errorResponse("catalog_hub_pilot_unavailable", 502);
  }
}
