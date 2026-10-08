import { z } from "zod";
import { prisma, stagingDatabaseConfigured } from "../offline/staging-store.js";

export const mediaProfileModeSchema = z.enum(["BOUND", "PAD", "COVER"]);
export const mediaProfileFormatSchema = z.enum(["jpeg", "png", "webp", "avif"]);

export const mediaProfileInputSchema = z.object({
  organizationId: z.string().min(1),
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  target: z.string().trim().max(64).optional(),
  width: z.number().int().min(64).max(6000),
  height: z.number().int().min(64).max(6000),
  mode: mediaProfileModeSchema.default("BOUND"),
  format: mediaProfileFormatSchema.default("webp"),
  quality: z.number().int().min(40).max(100).default(86),
  background: z.string().trim().min(1).max(32).default("#ffffff"),
  allowUpscale: z.boolean().default(false),
  removeBackground: z.boolean().default(false),
  trim: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const mediaProfileUpdateSchema = mediaProfileInputSchema
  .omit({ organizationId: true, code: true })
  .partial();

export type MediaProfileInput = z.infer<typeof mediaProfileInputSchema>;

export function mediaProfilesDatabaseConfigured() {
  return stagingDatabaseConfigured();
}

export async function listMediaProfiles(input: {
  organizationId: string;
  activeOnly?: boolean;
  target?: string;
}) {
  return prisma.mediaProfile.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.activeOnly === false ? {} : { isActive: true }),
      ...(input.target?.trim() ? { target: input.target.trim() } : {}),
    },
    orderBy: [{ target: "asc" }, { code: "asc" }],
  });
}

export async function getMediaProfile(input: {
  organizationId: string;
  code: string;
}) {
  return prisma.mediaProfile.findUnique({
    where: {
      organizationId_code: {
        organizationId: input.organizationId,
        code: input.code.trim(),
      },
    },
  });
}

export async function upsertMediaProfile(raw: unknown) {
  const input = mediaProfileInputSchema.parse(raw);

  return prisma.mediaProfile.upsert({
    where: {
      organizationId_code: {
        organizationId: input.organizationId,
        code: input.code,
      },
    },
    update: {
      name: input.name,
      target: input.target || null,
      width: input.width,
      height: input.height,
      mode: input.mode,
      format: input.format,
      quality: input.quality,
      background: input.background,
      allowUpscale: input.allowUpscale,
      removeBackground: input.removeBackground,
      trim: input.trim,
      isActive: input.isActive,
    },
    create: {
      organizationId: input.organizationId,
      code: input.code,
      name: input.name,
      target: input.target || null,
      width: input.width,
      height: input.height,
      mode: input.mode,
      format: input.format,
      quality: input.quality,
      background: input.background,
      allowUpscale: input.allowUpscale,
      removeBackground: input.removeBackground,
      trim: input.trim,
      isActive: input.isActive,
    },
  });
}

export async function updateMediaProfile(input: {
  organizationId: string;
  code: string;
  patch: unknown;
}) {
  const patch = mediaProfileUpdateSchema.parse(input.patch);
  return prisma.mediaProfile.update({
    where: {
      organizationId_code: {
        organizationId: input.organizationId,
        code: input.code.trim(),
      },
    },
    data: {
      ...patch,
      target: patch.target === undefined ? undefined : patch.target || null,
    },
  });
}
