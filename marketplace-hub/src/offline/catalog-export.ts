import { z } from "zod";

const exportProductSchema = z.object({
  sku: z.string().min(1),
  barcode: z.string().optional(),
  title: z.string().min(1),
  brand: z.string().optional(),
  description: z.string().optional(),
  categoryKey: z.string().optional(),
  attributes: z.record(z.unknown()).default({}),
  images: z.array(z.string()).default([]),
  price: z.number().int().positive().optional(),
  stock: z.number().int().nonnegative().default(0),
});

export const catalogExportSchema = z.object({
  source: z.string().default("catalog-hub"),
  generatedAt: z.string().optional(),
  products: z.array(exportProductSchema),
});

export type CatalogExport = z.infer<typeof catalogExportSchema>;

export function buildCatalogExport(input: CatalogExport) {
  const data = catalogExportSchema.parse(input);
  return {
    ...data,
    generatedAt: data.generatedAt ?? new Date().toISOString(),
    version: 1,
  };
}
