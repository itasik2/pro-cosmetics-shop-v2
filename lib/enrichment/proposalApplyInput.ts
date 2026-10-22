import { z } from "zod";

export const proposalApplySchema = z.object({
  mode: z
    .enum(["ALL", "DESCRIPTION", "DESCRIPTION_FINAL", "IMAGE", "INVENTORY"])
    .default("ALL"),
  publishNow: z.boolean().optional(),
  // A missing selection preserves the product's current common photo.
  // A local reference is accepted only after checking current product ownership.
  imageUrl: z.string().max(3000).refine((value) => {
    if (!value) return true;
    if (/^\/(?![/\\])/.test(value)) return true;
    try { return ["http:", "https:"].includes(new URL(value).protocol); }
    catch { return false; }
  }).nullable().optional(),
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
}).refine((value) => !value.publishNow || value.mode === "ALL", {
  path: ["publishNow"],
  message: "Для публикации примените карточку полностью.",
});

export type ProposalApplyInput = z.input<typeof proposalApplySchema>;
