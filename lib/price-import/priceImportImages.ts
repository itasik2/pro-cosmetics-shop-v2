import { v2 as cloudinary } from "cloudinary";
import type { EmbeddedPriceImage } from "./types";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function isConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  );
}

async function uploadOne(input: {
  fileHash: string;
  image: EmbeddedPriceImage;
}) {
  const extension = input.image.mimeType === "image/png" ? "png" : "jpg";
  const dataUri = `data:${input.image.mimeType};base64,${input.image.dataBase64}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    resource_type: "image",
    folder: `pro-cosmetics/price-imports/${input.fileHash.slice(0, 16)}`,
    public_id: `row-${String(input.image.rowNumber).padStart(3, "0")}`,
    overwrite: true,
    invalidate: false,
    format: extension,
  });
  return result.secure_url || result.url || "";
}

export async function uploadEmbeddedPriceImages(input: {
  fileHash: string;
  images: EmbeddedPriceImage[];
  concurrency?: number;
}) {
  const urls = new Map<number, string>();
  const warnings: string[] = [];
  if (!input.images.length) return { urls, warnings };

  if (!isConfigured()) {
    warnings.push("embedded_images_not_uploaded:cloudinary_not_configured");
    return { urls, warnings };
  }

  const limit = Math.max(1, Math.min(8, input.concurrency ?? 6));
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= input.images.length) return;
      const image = input.images[index];
      try {
        const url = await uploadOne({ fileHash: input.fileHash, image });
        if (url) urls.set(image.rowNumber, url);
        else warnings.push(`embedded_image_upload_empty:${image.rowNumber}`);
      } catch (error) {
        warnings.push(
          `embedded_image_upload_failed:${image.rowNumber}:${String(
            error instanceof Error ? error.message : error,
          ).slice(0, 160)}`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, input.images.length) }, () => worker()));
  return { urls, warnings };
}
