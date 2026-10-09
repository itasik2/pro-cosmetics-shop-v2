import sharp from "sharp";
import { z } from "zod";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export const mediaTransformSchema = z.object({
  width: z.number().int().min(64).max(6000).optional(),
  height: z.number().int().min(64).max(6000).optional(),
  maxWidth: z.number().int().min(64).max(6000).default(1600),
  maxHeight: z.number().int().min(64).max(6000).default(1600),
  mode: z.enum(["BOUND", "PAD", "COVER"]).default("BOUND"),
  format: z.enum(["jpeg", "png", "webp", "avif"]).default("webp"),
  quality: z.number().int().min(40).max(100).default(86),
  allowUpscale: z.boolean().default(false),
  background: z.string().default("#ffffff"),
  trim: z.boolean().default(false),
});

export type MediaTransform = z.input<typeof mediaTransformSchema>;

export const MEDIA_PRESETS = {
  master: {
    maxWidth: 2400,
    maxHeight: 2400,
    format: "webp",
    quality: 92,
    allowUpscale: false,
    background: "#ffffff",
  },
  storefront: {
    maxWidth: 1600,
    maxHeight: 1600,
    format: "webp",
    quality: 86,
    allowUpscale: false,
    background: "#ffffff",
  },
  marketplace: {
    maxWidth: 1600,
    maxHeight: 1600,
    format: "jpeg",
    quality: 90,
    allowUpscale: false,
    background: "#ffffff",
  },
  thumbnail: {
    maxWidth: 360,
    maxHeight: 360,
    format: "webp",
    quality: 80,
    allowUpscale: false,
    background: "#ffffff",
  },
} as const satisfies Record<string, MediaTransform>;

function mimeFromFormat(format?: string) {
  switch (format) {
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "tiff":
      return "image/tiff";
    case "gif":
      return "image/gif";
    default:
      return format ? `image/${format}` : "application/octet-stream";
  }
}

export async function analyzeImage(bytes: Buffer) {
  if (!bytes.byteLength) throw new Error("image_empty");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("image_too_large");

  const metadata = await sharp(bytes, { animated: false }).metadata();
  const width = metadata.width ?? null;
  const height = metadata.height ?? null;
  const warnings: string[] = [];

  if (!width || !height) warnings.push("dimensions_unknown");
  if (width && height && Math.min(width, height) < 600) {
    warnings.push("low_resolution");
  }
  if (width && height && Math.min(width, height) < 300) {
    warnings.push("very_low_resolution");
  }
  if (width && height) {
    const ratio = Math.max(width, height) / Math.max(1, Math.min(width, height));
    if (ratio > 3) warnings.push("extreme_aspect_ratio");
  }
  if ((metadata.pages ?? 1) > 1) warnings.push("animated_or_multipage_image");

  return {
    format: metadata.format ?? null,
    mimeType: mimeFromFormat(metadata.format),
    width,
    height,
    bytes: bytes.byteLength,
    hasAlpha: metadata.hasAlpha ?? false,
    pages: metadata.pages ?? 1,
    orientation: metadata.orientation ?? null,
    density: metadata.density ?? null,
    warnings,
  };
}

export async function transformImage(
  bytes: Buffer,
  rawTransform: MediaTransform,
) {
  const input = await analyzeImage(bytes);
  const transform = mediaTransformSchema.parse(rawTransform);
  const width = transform.width ?? transform.maxWidth;
  const height = transform.height ?? transform.maxHeight;

  let pipeline = sharp(bytes, { animated: false }).rotate();
  if (transform.trim) pipeline = pipeline.trim();

  if (transform.mode === "PAD") {
    pipeline = pipeline.resize({
      width,
      height,
      fit: "contain",
      withoutEnlargement: !transform.allowUpscale,
      background: transform.background,
    });
  } else if (transform.mode === "COVER") {
    pipeline = pipeline.resize({
      width,
      height,
      fit: "cover",
      withoutEnlargement: !transform.allowUpscale,
      position: "centre",
    });
  } else {
    pipeline = pipeline.resize({
      width,
      height,
      fit: "inside",
      withoutEnlargement: !transform.allowUpscale,
    });
  }

  if (transform.format === "jpeg") {
    pipeline = pipeline
      .flatten({ background: transform.background })
      .jpeg({ quality: transform.quality, mozjpeg: true });
  } else if (transform.format === "png") {
    pipeline = pipeline.png({ compressionLevel: 9 });
  } else if (transform.format === "avif") {
    pipeline = pipeline.avif({ quality: transform.quality });
  } else {
    pipeline = pipeline.webp({ quality: transform.quality });
  }

  const output = await pipeline.toBuffer({ resolveWithObject: true });

  return {
    source: input,
    output: {
      format: output.info.format,
      mimeType: mimeFromFormat(output.info.format),
      width: output.info.width,
      height: output.info.height,
      bytes: output.data.byteLength,
      base64: output.data.toString("base64"),
    },
    transform,
  };
}

export async function buildPresetVariants(bytes: Buffer) {
  const entries = await Promise.all(
    Object.entries(MEDIA_PRESETS).map(async ([name, preset]) => {
      const result = await transformImage(bytes, preset);
      return [name, result.output] as const;
    }),
  );

  return Object.fromEntries(entries);
}
