import { z } from "zod";
import { stagingPatchSchema, type StagingPatch } from "./staging.js";

const importProductSchema = z.object({
  title: z.string().trim().min(1),
  brand: z.string().trim().optional(),
  barcode: z.string().trim().optional(),
  description: z.string().trim().optional(),
  purchasePrice: z.number().int().nonnegative().optional(),
  price: z.number().int().nonnegative().optional(),
  stock: z.number().int().nonnegative().optional(),
});

export function importRowToStagingPatch(input: unknown): StagingPatch {
  const product = importProductSchema.parse(input);

  return stagingPatchSchema.parse({
    title: product.title,
    brand: product.brand,
    barcode: product.barcode,
    description: product.description,
    purchasePrice: product.purchasePrice ?? product.price,
    stock: product.stock,
  });
}

const aiProposalSchema = z.object({
  extracted: z.object({
    title: z.string().nullable().optional(),
    brand: z.string().nullable().optional(),
  }),
  draft: z.object({
    shortDescription: z.string().default(""),
    description: z.string().default(""),
    application: z.string().default(""),
    ingredients: z.string().default(""),
  }),
  imageCandidates: z
    .array(z.object({ url: z.string().url() }))
    .default([]),
});

export function aiProposalToStagingPatch(
  input: unknown,
  options?: {
    includeTitle?: boolean;
    includeBrand?: boolean;
    selectedImageUrl?: string;
  },
): StagingPatch {
  const proposal = aiProposalSchema.parse(input);
  const selectedImageUrl = options?.selectedImageUrl?.trim();

  if (
    selectedImageUrl &&
    !proposal.imageCandidates.some((image) => image.url === selectedImageUrl)
  ) {
    throw new Error("selected_image_not_in_proposal");
  }

  return stagingPatchSchema.parse({
    ...(options?.includeTitle && proposal.extracted.title
      ? { title: proposal.extracted.title }
      : {}),
    ...(options?.includeBrand && proposal.extracted.brand
      ? { brand: proposal.extracted.brand }
      : {}),
    ...(proposal.draft.shortDescription
      ? { shortDescription: proposal.draft.shortDescription }
      : {}),
    ...(proposal.draft.description
      ? { description: proposal.draft.description }
      : {}),
    ...(proposal.draft.application
      ? { application: proposal.draft.application }
      : {}),
    ...(proposal.draft.ingredients
      ? { ingredients: proposal.draft.ingredients }
      : {}),
    ...(selectedImageUrl ? { images: [selectedImageUrl] } : {}),
  });
}
