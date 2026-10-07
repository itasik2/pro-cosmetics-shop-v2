import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { masterCardSchema } from "./master-card.js";
import {
  prisma,
  stagingDatabaseConfigured,
} from "./staging-store.js";

export const createCatalogProductSchema = z.object({
  organizationId: z.string().min(1),
  warehouseId: z.string().min(1).optional(),
  card: masterCardSchema,
});

export const catalogListQuerySchema = z.object({
  organizationId: z.string().min(1),
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function serializeProduct(product: {
  id: string;
  organizationId: string;
  sku: string;
  barcode: string | null;
  title: string;
  brand: string | null;
  shortDescription: string | null;
  description: string | null;
  application: string | null;
  ingredients: string | null;
  categoryKey: string | null;
  attributes: Prisma.JsonValue | null;
  images: Prisma.JsonValue | null;
  purchasePrice: number | null;
  basePrice: number | null;
  createdAt: Date;
  updatedAt: Date;
  inventory?: Array<{
    warehouseId: string;
    onHand: number;
    reserved: number;
    safetyStock: number;
    warehouse: { code: string; name: string };
  }>;
}) {
  const inventory = product.inventory ?? [];
  const stock = inventory.reduce((sum, item) => sum + item.onHand, 0);
  const reserved = inventory.reduce((sum, item) => sum + item.reserved, 0);
  const safetyStock = inventory.reduce((sum, item) => sum + item.safetyStock, 0);

  return {
    id: product.id,
    organizationId: product.organizationId,
    sku: product.sku,
    barcode: product.barcode,
    title: product.title,
    brand: product.brand,
    shortDescription: product.shortDescription,
    description: product.description,
    application: product.application,
    ingredients: product.ingredients,
    categoryKey: product.categoryKey,
    attributes: product.attributes ?? {},
    images: Array.isArray(product.images) ? product.images : [],
    purchasePrice: product.purchasePrice,
    price: product.basePrice,
    inventory: inventory.map((item) => ({
      warehouseId: item.warehouseId,
      warehouseCode: item.warehouse.code,
      warehouseName: item.warehouse.name,
      onHand: item.onHand,
      reserved: item.reserved,
      safetyStock: item.safetyStock,
      available: Math.max(
        0,
        item.onHand - item.reserved - item.safetyStock,
      ),
    })),
    totals: {
      stock,
      reserved,
      safetyStock,
      available: Math.max(0, stock - reserved - safetyStock),
    },
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

const productInclude = {
  inventory: {
    include: {
      warehouse: {
        select: { code: true, name: true },
      },
    },
    orderBy: { warehouse: { code: "asc" as const } },
  },
} satisfies Prisma.ProductInclude;

export function catalogDatabaseConfigured() {
  return stagingDatabaseConfigured();
}

export async function createCatalogProduct(raw: unknown) {
  const input = createCatalogProductSchema.parse(raw);
  const card = input.card;

  if (card.stock !== undefined && !input.warehouseId) {
    throw new Error("warehouse_required_for_stock");
  }

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        organizationId: input.organizationId,
        sku: card.sku,
        barcode: card.barcode || null,
        title: card.title,
        brand: card.brand || null,
        shortDescription: card.shortDescription || null,
        description: card.description || null,
        application: card.application || null,
        ingredients: card.ingredients || null,
        categoryKey: card.categoryKey || null,
        attributes: json(card.attributes),
        images: json(card.images),
        purchasePrice: card.purchasePrice ?? null,
        basePrice: card.price ?? null,
      },
    });

    if (input.warehouseId && card.stock !== undefined) {
      await tx.inventory.create({
        data: {
          productId: product.id,
          warehouseId: input.warehouseId,
          onHand: card.stock,
        },
      });
    }

    const created = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
      include: productInclude,
    });

    return serializeProduct(created);
  });
}

export async function getCatalogProduct(input: {
  organizationId: string;
  id: string;
}) {
  const product = await prisma.product.findFirst({
    where: {
      id: input.id,
      organizationId: input.organizationId,
    },
    include: productInclude,
  });

  return product ? serializeProduct(product) : null;
}

export async function getCatalogProductBySku(input: {
  organizationId: string;
  sku: string;
}) {
  const product = await prisma.product.findUnique({
    where: {
      organizationId_sku: {
        organizationId: input.organizationId,
        sku: input.sku,
      },
    },
    include: productInclude,
  });

  return product ? serializeProduct(product) : null;
}

export async function listCatalogProducts(raw: unknown) {
  const query = catalogListQuerySchema.parse(raw);
  const q = query.q?.trim();

  const where: Prisma.ProductWhereInput = {
    organizationId: query.organizationId,
    ...(q
      ? {
          OR: [
            { sku: { contains: q, mode: "insensitive" } },
            { title: { contains: q, mode: "insensitive" } },
            { brand: { contains: q, mode: "insensitive" } },
            { barcode: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: query.offset,
      take: query.limit,
      include: productInclude,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items: items.map(serializeProduct),
    pagination: {
      total,
      limit: query.limit,
      offset: query.offset,
      hasMore: query.offset + items.length < total,
    },
  };
}

export async function databaseReady() {
  if (!catalogDatabaseConfigured()) return false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
