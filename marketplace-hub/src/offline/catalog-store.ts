import { Prisma } from "@prisma/client";
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
  incomplete: z.enum(["true", "false"]).optional(),
  category: z.string().trim().max(200).optional(),
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
  masterProductId?: string|null;
  masterProduct?: {id:string;title:string;brand:string|null;shortDescription:string|null;description:string|null;application:string|null;ingredients:string|null;categoryKey:string|null;updatedAt:Date}|null;
  inventory?: Array<{
    warehouseId: string;
    onHand: number;
    reserved: number;
    safetyStock: number;
    warehouse: { code: string; name: string };
  }>;
}) {
  const common=product.masterProduct||product;
  const inventory = product.inventory ?? [];
  const stock = inventory.reduce((sum, item) => sum + item.onHand, 0);
  const reserved = inventory.reduce((sum, item) => sum + item.reserved, 0);
  const safetyStock = inventory.reduce((sum, item) => sum + item.safetyStock, 0);

  return {
    id: product.id,
    organizationId: product.organizationId,
    sku: product.sku,
    masterProductId: product.masterProductId||null,
    masterUpdatedAt: product.masterProduct?.updatedAt.toISOString()||null,
    barcode: product.barcode,
    title: common.title,
    brand: common.brand,
    shortDescription: common.shortDescription,
    description: common.description,
    application: common.application,
    ingredients: common.ingredients,
    categoryKey: common.categoryKey,
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
      available: inventory.reduce((sum,item)=>sum+Math.max(0,item.onHand-item.reserved-item.safetyStock),0),
    },
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

const productInclude = {
  masterProduct:{select:{id:true,title:true,brand:true,shortDescription:true,description:true,application:true,ingredients:true,categoryKey:true,updatedAt:true}},
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

  if (card.stock !== undefined && card.stock !== 0) throw new Error("stock_movement_required");
  if (card.stock !== undefined && !input.warehouseId) {
    throw new Error("warehouse_required_for_stock");
  }

  return prisma.$transaction(async (tx) => {
    if(input.warehouseId){
      const warehouse=await tx.warehouse.findFirst({where:{id:input.warehouseId,organizationId:input.organizationId,isActive:true}});
      if(!warehouse)throw new Error("warehouse_not_found");
    }
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

    await tx.outboxEvent.create({data:{id:crypto.randomUUID(),organizationId:input.organizationId,topic:"catalog.product_changed",payload:{productId:product.id,created:true,actor:"node:internal"}}});
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

  const shared=(condition:Prisma.ProductWhereInput):Prisma.ProductWhereInput=>({OR:[
    {AND:[{masterProductId:null},condition]}, {masterProduct:{is:condition}},
  ]});
  const commonIncomplete:Prisma.ProductWhereInput={OR:[
    {categoryKey:null},{categoryKey:""},{categoryKey:"Без категории"},
    ...(["brand","shortDescription","description","application","ingredients"] as const).flatMap(field=>[{[field]:null},{[field]:""}]),
  ]};
  const where: Prisma.ProductWhereInput = {
    organizationId:query.organizationId,
    AND:[
      ...(query.category?[shared(query.category==="__uncategorized__"?{OR:[{categoryKey:null},{categoryKey:""},{categoryKey:"Без категории"}]}:{categoryKey:query.category})]:[]),
      ...(query.incomplete==="true"?[{OR:[shared(commonIncomplete),{images:{equals:[]}},{images:{equals:Prisma.DbNull}}]}]:[]),
      ...(q?[{OR:[{sku:{contains:q,mode:"insensitive" as const}},{barcode:{contains:q,mode:"insensitive" as const}},
        shared({OR:[{title:{contains:q,mode:"insensitive" as const}},{brand:{contains:q,mode:"insensitive" as const}}]})]}]:[]),
    ],
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
