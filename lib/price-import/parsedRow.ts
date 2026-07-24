import { z } from "zod";

export const ParsedImportRowSchema = z.object({
  pageNumber: z.number().int().positive(),
  rowNumber: z.number().int().positive(),
  brand: z.literal("ANGIOPHARM"),
  supplierSku: z.string().min(2).nullable(),
  originalName: z.string().min(2),
  normalizedName: z.string().min(2),
  volumeValue: z.number().int().nonnegative().nullable(),
  volumeUnit: z.enum(["ml", "g", "pcs", "pack", "roll"]).nullable(),
  volumeLabel: z.string(),
  sourcePrice: z.number().int().positive(),
  salePrice: z.number().int().nonnegative(),
  productLineCode: z.string().nullable(),
  productLineName: z.string().nullable(),
  category: z.string().min(1),
  sourceDate: z.string().nullable(),
  confidence: z.number().int().min(0).max(100),
  warnings: z.array(z.string()),
  existingProduct: z
    .object({
      id: z.string(),
      name: z.string(),
      price: z.number().int(),
    })
    .nullable()
    .optional(),
});

export type ParsedImportRow = z.infer<typeof ParsedImportRowSchema>;
