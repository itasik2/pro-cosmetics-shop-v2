import { z } from "zod";

export const proposalApplySchema = z.object({
  mode: z
    .enum(["ALL", "DESCRIPTION", "DESCRIPTION_FINAL", "IMAGE", "INVENTORY"])
    .default("ALL"),
  // A missing selection preserves the product's current common photo.
  imageUrl: z.string().url().max(3000).nullable().optional().or(z.literal("")),
  variantImages: z
    .array(
      z.object({
        variantId: z.string().min(1).max(150),
        sku: z.string().min(1).max(150),
        imageUrl: z.string().url().max(3000).nullable(),
      }),
    )
    .max(30)
    .optional(),
  stock: z.number().int().min(0).max(1_000_000).optional(),
  variantStocks: z
    .record(z.string(), z.number().int().min(0).max(1_000_000))
    .optional(),
});

export type ProposalApplyInput = z.input<typeof proposalApplySchema>;
