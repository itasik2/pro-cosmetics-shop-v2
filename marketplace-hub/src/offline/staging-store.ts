import { PrismaClient, type Prisma } from "@prisma/client";
import {
  applyApprovedChanges,
  buildCardDiff,
  type MutableCardField,
  type StagingPatch,
} from "./staging.js";
import { masterCardSchema, type MasterCardInput } from "./master-card.js";

const globalForPrisma = globalThis as unknown as {
  catalogHubPrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.catalogHubPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.catalogHubPrisma = prisma;
}

export function stagingDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function jsonArray(value: string[]): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function productToCard(input: {
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
}, stock?: number): MasterCardInput {
  return masterCardSchema.parse({
    sku: input.sku,
    barcode: input.barcode || undefined,
    title: input.title,
    brand: input.brand || undefined,
    shortDescription: input.shortDescription || undefined,
    description: input.description || undefined,
    application: input.application || undefined,
    ingredients: input.ingredients || undefined,
    categoryKey: input.categoryKey || undefined,
    attributes:
      input.attributes && typeof input.attributes === "object" && !Array.isArray(input.attributes)
        ? input.attributes
        : {},
    images: Array.isArray(input.images)
      ? input.images.filter((value): value is string => typeof value === "string")
      : [],
    purchasePrice: input.purchasePrice ?? undefined,
    price: input.basePrice ?? undefined,
    stock,
  });
}

export async function createChangeSet(input: {
  organizationId: string;
  productId?: string;
  sourceType: "IMPORT" | "AI_ENRICHMENT" | "MANUAL" | "SYSTEM";
  sourceRef?: string;
  current: MasterCardInput;
  proposed: StagingPatch;
  createdBy?: string;
}) {
  const current = masterCardSchema.parse(input.current);
  const diff = buildCardDiff(current, input.proposed);

  if (!diff.hasChanges) throw new Error("changeset_empty");

  return prisma.catalogChangeSet.create({
    data: {
      organizationId: input.organizationId,
      productId: input.productId,
      sku: current.sku,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
      current: json(current),
      proposed: json(input.proposed),
      summary: json(diff.summary),
      createdBy: input.createdBy,
      fields: {
        create: diff.changes.map((change) => ({
          field: change.field,
          risk: change.risk,
          beforeValue: json(change.before),
          afterValue: json(change.after),
        })),
      },
    },
    include: { fields: { orderBy: { createdAt: "asc" } } },
  });
}

export async function approveChangeSet(input: {
  id: string;
  approvedFields: MutableCardField[];
  approvedBy?: string;
}) {
  const changeSet = await prisma.catalogChangeSet.findUnique({
    where: { id: input.id },
    include: { fields: true },
  });
  if (!changeSet) throw new Error("changeset_not_found");
  if (["APPLIED", "REJECTED"].includes(changeSet.status)) {
    throw new Error("changeset_closed");
  }

  const allowed = new Set(changeSet.fields.map((field) => field.field));
  const approved = [...new Set(input.approvedFields)].filter((field) =>
    allowed.has(field),
  );
  if (!approved.length) throw new Error("approved_fields_empty");

  const now = new Date();
  await prisma.$transaction([
    prisma.catalogFieldChange.updateMany({
      where: { changeSetId: input.id, field: { in: approved } },
      data: {
        status: "APPROVED",
        approvedBy: input.approvedBy,
        approvedAt: now,
      },
    }),
    prisma.catalogChangeSet.update({
      where: { id: input.id },
      data: {
        status: "APPROVED",
        approvedFields: jsonArray(approved),
        approvedBy: input.approvedBy,
        approvedAt: now,
      },
    }),
  ]);

  return prisma.catalogChangeSet.findUnique({
    where: { id: input.id },
    include: { fields: { orderBy: { createdAt: "asc" } } },
  });
}

export async function rejectChangeSet(input: {
  id: string;
  rejectedBy?: string;
}) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const changeSet = await tx.catalogChangeSet.findUnique({
      where: { id: input.id },
      include: { fields: true },
    });
    if (!changeSet) throw new Error("changeset_not_found");
    if (changeSet.status === "APPLIED") throw new Error("changeset_already_applied");

    await tx.catalogFieldChange.updateMany({
      where: {
        changeSetId: input.id,
        status: { in: ["PROPOSED", "APPROVED"] },
      },
      data: { status: "REJECTED", rejectedAt: now },
    });

    return tx.catalogChangeSet.update({
      where: { id: input.id },
      data: {
        status: "REJECTED",
        rejectedAt: now,
        rejectedFields: jsonArray(changeSet.fields.map((field) => field.field)),
      },
      include: { fields: true },
    });
  });
}

export async function applyChangeSet(input: {
  id: string;
  appliedBy?: string;
  warehouseId?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const changeSet = await tx.catalogChangeSet.findUnique({
      where: { id: input.id },
      include: { fields: true },
    });
    if (!changeSet) throw new Error("changeset_not_found");
    if (!changeSet.productId) throw new Error("changeset_product_required");
    if (changeSet.status !== "APPROVED") throw new Error("changeset_not_approved");

    const approvedFields = changeSet.fields
      .filter((field) => field.status === "APPROVED")
      .map((field) => field.field as MutableCardField);

    if (!approvedFields.length) throw new Error("approved_fields_empty");
    if (approvedFields.includes("stock") && !input.warehouseId) {
      throw new Error("warehouse_required_for_stock");
    }

    const product = await tx.product.findUnique({
      where: { id: changeSet.productId },
    });
    if (!product) throw new Error("product_not_found");

    let stock: number | undefined;
    if (input.warehouseId) {
      const inventory = await tx.inventory.findUnique({
        where: {
          productId_warehouseId: {
            productId: product.id,
            warehouseId: input.warehouseId,
          },
        },
      });
      stock = inventory?.onHand ?? 0;
    }

    const actual = productToCard(product, stock);
    const original = masterCardSchema.parse(changeSet.current);
    const changedSincePreview = buildCardDiff(original, {
      barcode: actual.barcode,
      title: actual.title,
      brand: actual.brand,
      shortDescription: actual.shortDescription,
      description: actual.description,
      application: actual.application,
      ingredients: actual.ingredients,
      categoryKey: actual.categoryKey,
      attributes: actual.attributes,
      images: actual.images,
      purchasePrice: actual.purchasePrice,
      price: actual.price,
      ...(input.warehouseId ? { stock: actual.stock } : {}),
    });

    if (changedSincePreview.hasChanges) {
      throw new Error(
        `changeset_stale:${changedSincePreview.summary.changedFields.join(",")}`,
      );
    }

    const proposed = changeSet.proposed as StagingPatch;
    const applied = applyApprovedChanges({
      current: actual,
      proposed,
      approvedFields,
    });

    const updateData: Prisma.ProductUpdateInput = {};
    const revised = applied.revised;

    if (applied.appliedFields.includes("barcode")) {
      updateData.barcode = revised.barcode ?? null;
    }
    if (applied.appliedFields.includes("title")) updateData.title = revised.title;
    if (applied.appliedFields.includes("brand")) {
      updateData.brand = revised.brand ?? null;
    }
    if (applied.appliedFields.includes("shortDescription")) {
      updateData.shortDescription = revised.shortDescription ?? null;
    }
    if (applied.appliedFields.includes("description")) {
      updateData.description = revised.description ?? null;
    }
    if (applied.appliedFields.includes("application")) {
      updateData.application = revised.application ?? null;
    }
    if (applied.appliedFields.includes("ingredients")) {
      updateData.ingredients = revised.ingredients ?? null;
    }
    if (applied.appliedFields.includes("categoryKey")) {
      updateData.categoryKey = revised.categoryKey ?? null;
    }
    if (applied.appliedFields.includes("attributes")) {
      updateData.attributes = json(revised.attributes);
    }
    if (applied.appliedFields.includes("images")) {
      updateData.images = json(revised.images);
    }
    if (applied.appliedFields.includes("purchasePrice")) {
      updateData.purchasePrice = revised.purchasePrice ?? null;
    }
    if (applied.appliedFields.includes("price")) {
      updateData.basePrice = revised.price ?? null;
    }

    if (Object.keys(updateData).length) {
      await tx.product.update({
        where: { id: product.id },
        data: updateData,
      });
    }

    if (applied.appliedFields.includes("stock")) {
      await tx.inventory.upsert({
        where: {
          productId_warehouseId: {
            productId: product.id,
            warehouseId: input.warehouseId!,
          },
        },
        update: { onHand: revised.stock ?? 0 },
        create: {
          productId: product.id,
          warehouseId: input.warehouseId!,
          onHand: revised.stock ?? 0,
        },
      });
    }

    await tx.productRevision.create({
      data: {
        productId: product.id,
        changeSetId: changeSet.id,
        reason: "CHANGESET_APPLY",
        snapshot: json(actual),
        createdBy: input.appliedBy,
      },
    });

    const now = new Date();
    await tx.catalogFieldChange.updateMany({
      where: {
        changeSetId: changeSet.id,
        field: { in: applied.appliedFields },
        status: "APPROVED",
      },
      data: {
        status: "APPLIED",
        appliedBy: input.appliedBy,
        appliedAt: now,
      },
    });

    const nextStatus = applied.fullyApplied ? "APPLIED" : "PARTIALLY_APPLIED";
    await tx.catalogChangeSet.update({
      where: { id: changeSet.id },
      data: {
        status: nextStatus,
        appliedFields: jsonArray(applied.appliedFields),
        appliedBy: input.appliedBy,
        appliedAt: now,
      },
    });

    return {
      ...applied,
      changeSetId: changeSet.id,
      status: nextStatus,
    };
  });
}

export async function getChangeSet(id: string) {
  return prisma.catalogChangeSet.findUnique({
    where: { id },
    include: {
      fields: { orderBy: [{ risk: "desc" }, { createdAt: "asc" }] },
      revisions: { orderBy: { createdAt: "desc" } },
    },
  });
}
