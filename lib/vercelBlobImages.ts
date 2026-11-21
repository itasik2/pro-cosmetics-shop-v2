import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import sharp from "sharp";
import type { ProductImageNormalizationResult } from "@/lib/productImageNormalization";
import { productCutout } from "@/lib/productBackgroundRemoval";

const MIME: Record<string, string> = {
  jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", avif: "image/avif", tiff: "image/tiff",
};
const EXT: Record<string, string> = {
  jpeg: "jpg", png: "png", webp: "webp",
  gif: "gif", avif: "avif", tiff: "tiff",
};
const WHITE = "#ffffff";
const CANVAS = 1200;
const CONTENT = 960;

export function blobMediaEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

/** Immutable public URL. Uploads require server-side admin permissions. */
async function saveBlob(path: string, bytes: Buffer, contentType: string) {
  const result = await put(path, bytes, {
    access: "public",
    contentType,
    addRandomSuffix: false,
    cacheControlMaxAge: 31536000,
  });
  if (!result.url.startsWith("https://") ||
      !new URL(result.url).hostname.endsWith(".public.blob.vercel-storage.com")) {
    throw new Error("blob_upload_invalid_url");
  }
  return result.url;
}

function imageReader(bytes: Buffer) {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024)
    throw new Error("image_file_invalid_size");
  return sharp(bytes, { limitInputPixels: 40_000_000, animated: false, failOn: "error" });
}

async function sourceDetails(bytes: Buffer) {
  const metadata = await imageReader(bytes).metadata();
  const format = metadata.format || "";
  if (!(format in MIME)) throw new Error("unsupported_image_format");
  if (!metadata.width || !metadata.height) throw new Error("invalid_image_dimensions");
  return { contentType: MIME[format], extension: EXT[format], width: metadata.width, height: metadata.height };
}

/** Places a product photo or transparent cutout on the standard white WebP canvas. */
export async function localCatalogDerivative(bytes: Buffer): Promise<Buffer> {
  let cropped: Buffer;
  try {
    cropped = await imageReader(bytes).rotate().flatten({ background: WHITE })
      .trim({ background: WHITE, threshold: 8 }).toBuffer();
  } catch {
    cropped = await imageReader(bytes).rotate().flatten({ background: WHITE }).toBuffer();
  }
  const { data, info } = await imageReader(cropped)
    .resize(CONTENT, CONTENT, { fit: "inside" }).toBuffer({ resolveWithObject: true });
  const horiz = CANVAS - info.width;
  const vert = CANVAS - info.height;
  if (horiz < 0 || vert < 0) throw new Error("image_canvas_overflow");
  return sharp(data).extend({
    left: Math.floor(horiz / 2), right: Math.ceil(horiz / 2),
    top: Math.floor(vert / 2), bottom: Math.ceil(vert / 2),
    background: WHITE,
  }).webp({ quality: 84, effort: 4 }).toBuffer();
}

export async function uploadProductImageToBlob(
  bytes: Buffer,
  options: { removeBackground?: boolean } = {},
): Promise<ProductImageNormalizationResult> {
  if (!blobMediaEnabled()) throw new Error("blob_storage_not_configured");
  const meta = await sourceDetails(bytes);
  const unique = randomUUID();
  const originalUrl = await saveBlob(
    "pro-cosmetics/products/originals/" + unique + "." + meta.extension,
    bytes, meta.contentType,
  );
  try {
    let cutout: Buffer | null = null;
    if (options.removeBackground !== false) {
      try {
        cutout = await productCutout(bytes);
      } catch (error) {
        if (!(error instanceof Error && error.message === "background_mask_uncertain")) {
          console.warn("product_background_removal_failed", error);
        }
      }
    }
    const processedBytes = await localCatalogDerivative(cutout ?? bytes);
    const directory = cutout ? "background-removed" : "drafts";
    const displayUrl = await saveBlob(
      "pro-cosmetics/products/" + directory + "/" + unique + ".webp",
      processedBytes, "image/webp",
    );
    return {
      url: displayUrl, originalUrl, processedUrl: cutout ? displayUrl : null,
      publicId: "blob:" + unique,
      status: cutout ? "PROCESSED" : "NEEDS_REVIEW",
      error: cutout ? null : options.removeBackground === false
        ? "product_image_normalization_disabled" : "ai_background_removal_pending",
      width: CANVAS, height: CANVAS,
    };
  } catch (error) {
    // Preserve the uploaded source, never return a URL that wasn't persisted.
    return {
      url: originalUrl, originalUrl, processedUrl: null,
      publicId: "blob:" + unique, status: "NEEDS_REVIEW",
      error: error instanceof Error ? error.message.slice(0, 140) : "image_processing_failed",
      width: meta.width, height: meta.height,
    };
  }
}

/** Shared uploads for blog, site settings and supplier price-list photos. */
export async function uploadGenericImageToBlob(bytes: Buffer, folder = "uploads") {
  if (!blobMediaEnabled()) throw new Error("blob_storage_not_configured");
  const meta = await sourceDetails(bytes);
  const unique = randomUUID();
  const safeFolder = folder.replace(/[^a-z0-9/_-]/gi, "").slice(0, 100) || "uploads";
  const originalUrl = await saveBlob(
    "pro-cosmetics/" + safeFolder + "/originals/" + unique + "." + meta.extension,
    bytes, meta.contentType,
  );
  const processed = await imageReader(bytes).rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 83, effort: 4 }).toBuffer();
  const url = await saveBlob(
    "pro-cosmetics/" + safeFolder + "/processed/" + unique + ".webp",
    processed, "image/webp",
  );
  return { url, originalUrl };
}
