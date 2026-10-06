import { z } from "zod";

export const masterCardSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  barcode: z.string().trim().optional(),
  title: z.string().trim().min(1),
  brand: z.string().trim().optional(),
  description: z.string().trim().optional(),
  categoryKey: z.string().trim().optional(),
  attributes: z.record(z.unknown()).default({}),
  images: z.array(z.string().url()).default([]),
  purchasePrice: z.number().int().nonnegative().optional(),
  price: z.number().int().positive().optional(),
  stock: z.number().int().nonnegative().optional(),
});

export type MasterCardInput = z.infer<typeof masterCardSchema>;

export function validateMasterCard(input: unknown) {
  const result = masterCardSchema.safeParse(input);
  if (result.success) {
    const warnings: string[] = [];
    if (!result.data.brand) warnings.push("Brand is not set");
    if (!result.data.description) warnings.push("Description is not set");
    if (result.data.images.length === 0) warnings.push("Images are not set");
    if (!result.data.categoryKey) warnings.push("Marketplace category is not mapped");

    return {
      valid: true as const,
      card: result.data,
      warnings,
    };
  }

  return {
    valid: false as const,
    errors: result.error.flatten(),
  };
}
