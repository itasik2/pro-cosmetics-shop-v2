export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";
import { processStockAlertsForProduct } from "@/lib/stockAlerts";

const VariantStockSchema = z.object({
  stocks: z
    .array(
      z.object({
        variantId: z.string().min(1).max(160),
        stock: z.number().int().min(0).max(1_000_000),
      }),
    )
    .min(1)
    .max(100),
});

type Params = { params: { id: string } };

type VariantRow = Record<string, unknown>;

function normalizeVariants(value: unknown): VariantRow[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is VariantRow => Boolean(row) && typeof row === "object",
      )
    : [];
}

export async function PATCH(req: Request, { params }: Params) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const parsed = VariantStockSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const product = await prisma.product.findUnique({
    where: { id: params.id },
    select: { id: true, variants: true },
  });
  if (!product) {
    return NextResponse.json({ error: "product_not_found" }, { status: 404 });
  }

  const variants = normalizeVariants(product.variants);
  if (variants.length === 0) {
    return NextResponse.json(
      { error: "product_has_no_variants" },
      { status: 409 },
    );
  }

  const requested = new Map(
    parsed.data.stocks.map((row) => [row.variantId, row.stock]),
  );
  const knownIds = new Set(variants.map((row) => String(row.id || "")));
  const unknownIds = [...requested.keys()].filter((id) => !knownIds.has(id));
  if (unknownIds.length > 0) {
    return NextResponse.json(
      { error: "variant_not_found", variantIds: unknownIds },
      { status: 404 },
    );
  }

  const nextVariants = variants.map((row) => {
    const id = String(row.id || "");
    return requested.has(id) ? { ...row, stock: requested.get(id) } : row;
  });
  const totalStock = nextVariants.reduce(
    (sum, row) => sum + Math.max(0, Math.trunc(Number(row.stock) || 0)),
    0,
  );

  const updated = await prisma.product.update({
    where: { id: product.id },
    data: {
      variants: nextVariants,
      stock: totalStock,
    },
    select: {
      id: true,
      stock: true,
      variants: true,
    },
  });

  await processStockAlertsForProduct(updated.id);

  return NextResponse.json({
    ok: true,
    productId: updated.id,
    stock: updated.stock,
    variants: updated.variants,
  });
}
