export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";
import {
  createCatalogHubProduct,
  getCatalogHubProductBySku,
  getCatalogHubShadowConfig,
  type CatalogHubCreateCard,
} from "@/lib/catalogHubClient";
import { getPublicBaseUrl } from "@/lib/siteConfig";

const RequestSchema = z.object({
  dryRun: z.boolean().default(true),
  limit: z.number().int().min(1).max(30).default(10),
});

function toImageUrl(value: string) {
  const raw = value.trim();
  if (!raw) return null;

  try {
    return new URL(raw).toString();
  } catch {
    try {
      return new URL(raw, getPublicBaseUrl()).toString();
    } catch {
      return null;
    }
  }
}

function toCard(product: {
  id: string;
  slug: string;
  supplierSku: string | null;
  barcode: string | null;
  name: string;
  shortDescription: string | null;
  description: string;
  image: string;
  category: string;
  price: number;
  sourcePrice: number | null;
  stock: number;
  volumeValue: number | null;
  volumeUnit: string | null;
  productLineCode: string | null;
  productLineName: string | null;
  variants: unknown;
  brand: { name: string } | null;
}): CatalogHubCreateCard | null {
  const sku = product.supplierSku?.trim();
  if (!sku) return null;

  const imageUrl = toImageUrl(product.image);

  return {
    sku,
    barcode: product.barcode?.trim() || undefined,
    title: product.name,
    brand: product.brand?.name || undefined,
    shortDescription: product.shortDescription?.trim() || undefined,
    description: product.description?.trim() || undefined,
    categoryKey: product.category,
    attributes: {
      legacyProductId: product.id,
      legacySlug: product.slug,
      volumeValue: product.volumeValue,
      volumeUnit: product.volumeUnit,
      productLineCode: product.productLineCode,
      productLineName: product.productLineName,
      variants: product.variants,
    },
    images: imageUrl ? [imageUrl] : [],
    purchasePrice: product.sourcePrice ?? undefined,
    price: product.price,
    stock: product.stock,
  };
}

function errorMessage(error: unknown) {
  return String(error instanceof Error ? error.message : error || "unknown_error")
    .replace(/\s+/g, " ")
    .slice(0, 600);
}

export async function POST(request: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  let parsedBody: z.infer<typeof RequestSchema>;
  try {
    parsedBody = RequestSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error: "validation",
        details: error instanceof z.ZodError ? error.flatten() : undefined,
      },
      { status: 400 },
    );
  }

  const config = getCatalogHubShadowConfig();

  if (!config.configured) {
    return NextResponse.json(
      { error: "catalog_hub_not_configured" },
      { status: 503 },
    );
  }

  if (!parsedBody.dryRun && !config.writeEnabled) {
    return NextResponse.json(
      { error: "catalog_hub_write_disabled" },
      { status: 403 },
    );
  }

  if (!parsedBody.dryRun && !config.warehouseId) {
    return NextResponse.json(
      { error: "catalog_hub_warehouse_not_configured" },
      { status: 503 },
    );
  }

  const products = await prisma.product.findMany({
    where: {
      isPublished: true,
      enrichmentStatus: { not: "MERGED" },
      supplierSku: { not: null },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: parsedBody.limit,
    select: {
      id: true,
      slug: true,
      supplierSku: true,
      barcode: true,
      name: true,
      shortDescription: true,
      description: true,
      image: true,
      category: true,
      price: true,
      sourcePrice: true,
      stock: true,
      volumeValue: true,
      volumeUnit: true,
      productLineCode: true,
      productLineName: true,
      variants: true,
      brand: { select: { name: true } },
    },
  });

  const results: Array<Record<string, unknown>> = [];

  for (const product of products) {
    const card = toCard(product);
    if (!card) {
      results.push({
        status: "SKIPPED",
        localProductId: product.id,
        reason: "supplier_sku_empty",
      });
      continue;
    }

    try {
      const existing = await getCatalogHubProductBySku(card.sku);
      if (existing) {
        results.push({
          status: "ALREADY_EXISTS",
          localProductId: product.id,
          sku: card.sku,
          hubProductId: existing.id,
        });
        continue;
      }

      if (parsedBody.dryRun) {
        results.push({
          status: "WOULD_CREATE",
          localProductId: product.id,
          sku: card.sku,
          card,
        });
        continue;
      }

      const created = await createCatalogHubProduct(card);
      results.push({
        status: "CREATED",
        localProductId: product.id,
        sku: card.sku,
        hubProductId: created.id,
      });
    } catch (error) {
      const message = errorMessage(error);

      if (message.startsWith("catalog_hub_http_409:")) {
        const existing = await getCatalogHubProductBySku(card.sku).catch(
          () => null,
        );
        results.push({
          status: "ALREADY_EXISTS",
          localProductId: product.id,
          sku: card.sku,
          hubProductId: existing?.id || null,
        });
        continue;
      }

      results.push({
        status: "ERROR",
        localProductId: product.id,
        sku: card.sku,
        error: message,
      });
    }
  }

  const count = (status: string) =>
    results.filter((item) => item.status === status).length;

  return NextResponse.json(
    {
      mode: parsedBody.dryRun ? "DRY_RUN" : "WRITE",
      writeEnabled: config.writeEnabled,
      warehouseConfigured: Boolean(config.warehouseId),
      requested: parsedBody.limit,
      processed: results.length,
      summary: {
        wouldCreate: count("WOULD_CREATE"),
        created: count("CREATED"),
        alreadyExists: count("ALREADY_EXISTS"),
        skipped: count("SKIPPED"),
        errors: count("ERROR"),
      },
      results,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
