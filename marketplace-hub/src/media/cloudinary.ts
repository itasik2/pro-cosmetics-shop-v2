import { v2 as cloudinary } from "cloudinary";

function envInt(name: string, fallback: number, min: number, max: number) {
  const value = Math.trunc(Number(process.env[name]));
  return Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

function credentials() {
  return {
    cloud_name:
      process.env.CATALOG_CLOUDINARY_CLOUD_NAME ||
      process.env.CLOUDINARY_CLOUD_NAME,
    api_key:
      process.env.CATALOG_CLOUDINARY_API_KEY ||
      process.env.CLOUDINARY_API_KEY,
    api_secret:
      process.env.CATALOG_CLOUDINARY_API_SECRET ||
      process.env.CLOUDINARY_API_SECRET,
  };
}

export function cloudinaryMediaConfigured() {
  const config = credentials();
  return Boolean(config.cloud_name && config.api_key && config.api_secret);
}

function configure() {
  const config = credentials();
  if (!config.cloud_name || !config.api_key || !config.api_secret) {
    throw new Error("cloudinary_not_configured");
  }
  cloudinary.config(config);
}

function uploadBuffer(buffer: Buffer, folder: string): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (error, result) => {
        if (error || !result) {
          reject(error || new Error("cloudinary_upload_failed"));
          return;
        }
        resolve(result as Record<string, any>);
      },
    );
    stream.end(buffer);
  });
}

export async function normalizeCatalogImageWithCloudinary(
  buffer: Buffer,
  options?: {
    folder?: string;
    canvas?: number;
    content?: number;
    background?: string;
  },
) {
  configure();

  const canvas =
    options?.canvas ??
    envInt("CATALOG_IMAGE_CANVAS_SIZE", 1200, 600, 2400);
  const content = Math.min(
    options?.content ??
      envInt("CATALOG_IMAGE_CONTENT_SIZE", 960, 400, canvas),
    canvas,
  );
  const background =
    String(
      options?.background ||
        process.env.CATALOG_IMAGE_BACKGROUND ||
        "white",
    )
      .trim()
      .replace(/^#/, "") || "white";
  const folder = options?.folder || "catalog-hub/products/originals";

  const uploaded = await uploadBuffer(buffer, folder);
  const originalUrl = String(uploaded.secure_url || "").trim();
  const publicId = String(uploaded.public_id || "").trim();

  if (!originalUrl || !publicId) {
    throw new Error("cloudinary_original_missing");
  }

  try {
    const explicit = (await cloudinary.uploader.explicit(publicId, {
      type: "upload",
      resource_type: "image",
      eager: [
        {
          transformation: [
            { effect: "background_removal" },
            { effect: "trim:10" },
            { width: content, height: content, crop: "limit" },
            {
              width: canvas,
              height: canvas,
              crop: "pad",
              gravity: "center",
              background,
            },
            { quality: "auto:good" },
          ],
          format: "webp",
        },
      ],
      eager_async: false,
    })) as Record<string, any>;

    const processedUrl = String(explicit?.eager?.[0]?.secure_url || "").trim();

    return {
      status: processedUrl ? ("PROCESSED" as const) : ("NEEDS_REVIEW" as const),
      originalUrl,
      processedUrl: processedUrl || null,
      url: processedUrl || originalUrl,
      publicId,
      width: typeof uploaded.width === "number" ? uploaded.width : null,
      height: typeof uploaded.height === "number" ? uploaded.height : null,
      canvas,
      content,
      background,
      error: processedUrl ? null : "normalized_image_url_missing",
    };
  } catch (error) {
    return {
      status: "NEEDS_REVIEW" as const,
      originalUrl,
      processedUrl: null,
      url: originalUrl,
      publicId,
      width: typeof uploaded.width === "number" ? uploaded.width : null,
      height: typeof uploaded.height === "number" ? uploaded.height : null,
      canvas,
      content,
      background,
      error:
        error instanceof Error
          ? error.message.slice(0, 500)
          : "normalization_failed",
    };
  }
}
