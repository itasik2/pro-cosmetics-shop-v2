export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import { normalizeProductImage } from "@/lib/productImageNormalization";
import { prisma } from "@/lib/prisma";

const BatchSchema = z.object({
  limit: z.number().int().min(1).max(5).optional().default(3),
});

const eligibleWhere = {
  image: {
    startsWith: "https://",
    not: { contains: "e_background_removal" },
  },
  enrichmentStatus: { not: "MERGED" },
} as const;

function hostname(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function counts() {
  const [remaining, normalized] = await Promise.all([
    prisma.product.count({ where: eligibleWhere }),
    prisma.product.count({
      where: {
        image: { contains: "e_background_removal" },
        enrichmentStatus: { not: "MERGED" },
      },
    }),
  ]);
  return { remaining, normalized };
}

export async function GET() {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  return NextResponse.json(await counts());
}

export async function POST(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const parsed = BatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const products = await prisma.product.findMany({
    where: eligibleWhere,
    orderBy: { updatedAt: "asc" },
    take: parsed.data.limit,
    select: {
      id: true,
      name: true,
      image: true,
    },
  });

  const results: Array<{
    id: string;
    name: string;
    status: "processed" | "failed";
    error?: string;
  }> = [];

  for (const product of products) {
    try {
      const normalized = await normalizeProductImage(product.image, {
        folder: "pro-cosmetics/products/catalog-originals",
      });

      if (!normalized.processedUrl) {
        results.push({
          id: product.id,
          name: product.name,
          status: "failed",
          error: normalized.error || "normalization_failed",
        });
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await tx.productImage.updateMany({
          where: { productId: product.id },
          data: { isPrimary: false },
        });

        const existing = await tx.productImage.findFirst({
          where: { productId: product.id, url: normalized.url },
          select: { id: true },
        });

        if (existing) {
          await tx.productImage.update({
            where: { id: existing.id },
            data: { isPrimary: true },
          });
        } else {
          await tx.productImage.create({
            data: {
              productId: product.id,
              url: normalized.url,
              sourceUrl: normalized.originalUrl,
              sourceDomain: hostname(product.image),
              width: normalized.width,
              height: normalized.height,
              isPrimary: true,
            },
          });
        }

        await tx.product.update({
          where: { id: product.id },
          data: { image: normalized.url },
        });
      });

      results.push({ id: product.id, name: product.name, status: "processed" });
    } catch (error) {
      results.push({
        id: product.id,
        name: product.name,
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 300) : "normalization_failed",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: results.filter((item) => item.status === "processed").length,
    failed: results.filter((item) => item.status === "failed").length,
    results,
    ...(await counts()),
  });
}
