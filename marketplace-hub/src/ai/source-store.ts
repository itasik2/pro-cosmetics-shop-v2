import { z } from "zod";
import { prisma } from "../offline/staging-store.js";

const supplierSchema = z.object({
  organizationId: z.string().min(1),
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  isActive: z.boolean().default(true),
});

const sourcePolicySchema = z.object({
  organizationId: z.string().min(1),
  supplierCode: z.string().trim().min(1),
  name: z.string().trim().min(1).max(160),
  domain: z.string().trim().min(1).max(253),
  baseUrl: z.string().url().optional(),
  sourceType: z.enum(["OFFICIAL_SITE", "DISTRIBUTOR", "DISCOVERED_WEB"]).default("OFFICIAL_SITE"),
  allowSubdomains: z.boolean().default(true),
  isEnabled: z.boolean().default(true),
  priority: z.number().int().min(-1000).max(1000).default(0),
});

const productSupplierSchema = z
  .object({
    organizationId: z.string().min(1),
    productId: z.string().min(1).optional(),
    sku: z.string().trim().min(1).optional(),
    supplierCode: z.string().trim().min(1),
    supplierSku: z.string().trim().optional(),
    barcode: z.string().trim().optional(),
    purchasePrice: z.number().int().nonnegative().optional(),
    lastStock: z.number().int().nonnegative().optional(),
  })
  .refine((value) => Boolean(value.productId || value.sku), {
    message: "productId_or_sku_required",
  });

function normalizeDomain(value: string) {
  const raw = value.trim().toLowerCase().replace(/\.$/, "");
  if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw);
    return url.hostname.toLowerCase().replace(/\.$/, "");
  }
  if (!/^[a-z0-9.-]+$/i.test(raw) || !raw.includes(".")) {
    throw new Error("source_domain_invalid");
  }
  return raw;
}

export async function upsertSupplier(raw: unknown) {
  const input = supplierSchema.parse(raw);

  return prisma.supplier.upsert({
    where: {
      organizationId_code: {
        organizationId: input.organizationId,
        code: input.code,
      },
    },
    update: {
      name: input.name,
      isActive: input.isActive,
    },
    create: input,
  });
}

export async function listSuppliers(input: {
  organizationId: string;
  activeOnly?: boolean;
}) {
  return prisma.supplier.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.activeOnly === false ? {} : { isActive: true }),
    },
    orderBy: [{ name: "asc" }, { code: "asc" }],
    include: {
      _count: {
        select: {
          products: true,
          sourcePolicies: true,
        },
      },
    },
  });
}

export async function upsertSourcePolicy(raw: unknown) {
  const input = sourcePolicySchema.parse(raw);
  const supplier = await prisma.supplier.findUnique({
    where: {
      organizationId_code: {
        organizationId: input.organizationId,
        code: input.supplierCode,
      },
    },
  });
  if (!supplier) throw new Error("supplier_not_found");

  const domain = normalizeDomain(input.domain);

  return prisma.catalogSourcePolicy.upsert({
    where: {
      supplierId_domain: {
        supplierId: supplier.id,
        domain,
      },
    },
    update: {
      name: input.name,
      baseUrl: input.baseUrl || null,
      sourceType: input.sourceType,
      allowSubdomains: input.allowSubdomains,
      isEnabled: input.isEnabled,
      priority: input.priority,
    },
    create: {
      supplierId: supplier.id,
      name: input.name,
      domain,
      baseUrl: input.baseUrl || null,
      sourceType: input.sourceType,
      allowSubdomains: input.allowSubdomains,
      isEnabled: input.isEnabled,
      priority: input.priority,
    },
  });
}

export async function listSourcePolicies(input: {
  organizationId: string;
  supplierCode?: string;
  enabledOnly?: boolean;
}) {
  return prisma.catalogSourcePolicy.findMany({
    where: {
      supplier: {
        organizationId: input.organizationId,
        ...(input.supplierCode ? { code: input.supplierCode } : {}),
      },
      ...(input.enabledOnly === false ? {} : { isEnabled: true }),
    },
    orderBy: [
      { priority: "desc" },
      { domain: "asc" },
    ],
    include: {
      supplier: {
        select: { id: true, code: true, name: true },
      },
    },
  });
}

export async function linkProductSupplier(raw: unknown) {
  const input = productSupplierSchema.parse(raw);

  const supplier = await prisma.supplier.findUnique({
    where: {
      organizationId_code: {
        organizationId: input.organizationId,
        code: input.supplierCode,
      },
    },
  });
  if (!supplier) throw new Error("supplier_not_found");

  const product = input.productId
    ? await prisma.product.findFirst({
        where: {
          id: input.productId,
          organizationId: input.organizationId,
        },
      })
    : await prisma.product.findUnique({
        where: {
          organizationId_sku: {
            organizationId: input.organizationId,
            sku: input.sku!,
          },
        },
      });

  if (!product) throw new Error("product_not_found");

  return prisma.supplierProduct.upsert({
    where: {
      supplierId_productId: {
        supplierId: supplier.id,
        productId: product.id,
      },
    },
    update: {
      supplierSku: input.supplierSku || null,
      barcode: input.barcode || null,
      purchasePrice: input.purchasePrice ?? null,
      lastStock: input.lastStock ?? null,
      lastSeenAt: new Date(),
    },
    create: {
      supplierId: supplier.id,
      productId: product.id,
      supplierSku: input.supplierSku || null,
      barcode: input.barcode || null,
      purchasePrice: input.purchasePrice ?? null,
      lastStock: input.lastStock ?? null,
      lastSeenAt: new Date(),
    },
  });
}
