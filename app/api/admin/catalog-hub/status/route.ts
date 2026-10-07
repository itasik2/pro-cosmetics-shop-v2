export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";
import {
  compareLegacyProductToSnapshot,
  getCatalogHubHealth,
  getCatalogHubShadowConfig,
  getCatalogHubSnapshot,
} from "@/lib/catalogHubClient";

function readLimit(request: Request) {
  const raw = Number(new URL(request.url).searchParams.get("limit") || 50);
  return Number.isFinite(raw) ? Math.max(1, Math.min(200, Math.trunc(raw))) : 50;
}

function shortError(error: unknown) {
  return String(error instanceof Error ? error.message : error || "unknown_error")
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

export async function GET(request: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const config = getCatalogHubShadowConfig();
  const publicConfig = {
    enabled: config.enabled,
    writeEnabled: config.writeEnabled,
    readEnabled: config.readEnabled,
    readStrict: config.readStrict,
    configured: config.configured,
    baseUrl: config.baseUrl || null,
    organizationId: config.organizationId || null,
    warehouseId: config.warehouseId || null,
    hasApiKey: config.hasApiKey,
    timeoutMs: config.timeoutMs,
  };

  if (!config.baseUrl) {
    return NextResponse.json(
      {
        ok: false,
        config: publicConfig,
        health: null,
        summary: null,
        comparisons: [],
        error: "catalog_hub_url_not_configured",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const health = await getCatalogHubHealth();

  if (!config.enabled || !config.configured) {
    return NextResponse.json(
      {
        ok: health.health.ok,
        config: publicConfig,
        health,
        summary: null,
        comparisons: [],
        error: config.enabled
          ? "catalog_hub_shadow_not_fully_configured"
          : "catalog_hub_shadow_disabled",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const products = await prisma.product.findMany({
    where: {
      isPublished: true,
      supplierSku: { not: null },
      enrichmentStatus: { not: "MERGED" },
    },
    orderBy: { updatedAt: "desc" },
    take: readLimit(request),
    select: {
      id: true,
      supplierSku: true,
      name: true,
      shortDescription: true,
      description: true,
      price: true,
      sourcePrice: true,
      stock: true,
      brand: { select: { name: true } },
    },
  });

  let snapshot;
  try {
    snapshot = await getCatalogHubSnapshot();
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        config: publicConfig,
        health,
        summary: null,
        comparisons: [],
        error: shortError(error),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const bySku = new Map(snapshot.items.map((item) => [item.sku, item]));
  const comparisons: Array<Record<string, unknown>> = [];

  for (const product of products) {
    const sku = product.supplierSku?.trim() || "";
    if (!sku) {
      comparisons.push({
        status: "SKIPPED",
        localProductId: product.id,
        sku: null,
        reason: "supplier_sku_empty",
      });
      continue;
    }

    const hub = bySku.get(sku);
    if (!hub) {
      comparisons.push({
        status: "NOT_FOUND",
        localProductId: product.id,
        sku,
      });
      continue;
    }

    const comparison = compareLegacyProductToSnapshot(
      {
        id: product.id,
        supplierSku: sku,
        name: product.name,
        brandName: product.brand?.name || null,
        shortDescription: product.shortDescription,
        description: product.description,
        price: product.price,
        sourcePrice: product.sourcePrice,
        stock: product.stock,
      },
      hub,
    );

    comparisons.push({
      status: comparison.matched ? "MATCH" : "DIFF",
      ...comparison,
    });
  }

  const count = (status: string) =>
    comparisons.filter((item) => item.status === status).length;

  const summary = {
    checked: comparisons.length,
    match: count("MATCH"),
    diff: count("DIFF"),
    notFound: count("NOT_FOUND"),
    errors: count("ERROR"),
    skipped: count("SKIPPED"),
  };

  return NextResponse.json(
    {
      ok: health.health.ok && health.ready.ok,
      config: publicConfig,
      health,
      summary: {
        ...summary,
        hubTotal: snapshot.total,
      },
      comparisons,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
