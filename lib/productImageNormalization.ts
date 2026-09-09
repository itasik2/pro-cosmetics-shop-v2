import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export type ProductImageNormalizationStatus =
  | "PROCESSED"
  | "NEEDS_REVIEW";

export type ProductImageNormalizationResult = {
  url: string;
  originalUrl: string;
  processedUrl: string | null;
  publicId: string;
  status: ProductImageNormalizationStatus;
  error: string | null;
  width: number | null;
  height: number | null;
};

const DEFAULT_CANVAS = 1200;
const DEFAULT_CONTENT = 960;

function envInt(name: string, fallback: number, min: number, max: number) {
  const value = Math.trunc(Number(process.env[name]));
  return Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

export function productImageNormalizationEnabled() {
  return process.env.PRODUCT_IMAGE_NORMALIZATION_ENABLED !== "false";
}

function ensureCloudinaryConfigured() {
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new Error("cloudinary_not_configured");
  }
}

function productTransformation() {
  const canvas = envInt(
    "PRODUCT_IMAGE_CANVAS_SIZE",
    DEFAULT_CANVAS,
    600,
    2400,
  );
  const requestedContent = envInt(
    "PRODUCT_IMAGE_CONTENT_SIZE",
    DEFAULT_CONTENT,
    400,
    canvas,
  );
  const content = Math.min(requestedContent, canvas);
  const background =
    String(process.env.PRODUCT_IMAGE_BACKGROUND || "white")
      .trim()
      .replace(/^#/, "") || "white";

  return {
    canvas,
    content,
    background,
    chain: [
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
  };
}

function uploadBuffer(
  buffer: Buffer,
  folder: string,
): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
      },
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

async function uploadSource(source: Buffer | string, folder: string) {
  ensureCloudinaryConfigured();
  if (Buffer.isBuffer(source)) return uploadBuffer(source, folder);

  const value = String(source || "").trim();
  if (!/^https:\/\//i.test(value)) {
    throw new Error("product_image_source_must_be_https");
  }

  return cloudinary.uploader.upload(value, {
    folder,
    resource_type: "image",
  }) as Promise<Record<string, any>>;
}

async function createCatalogDerivative(publicId: string) {
  const { chain } = productTransformation();
  return cloudinary.uploader.explicit(publicId, {
    type: "upload",
    resource_type: "image",
    eager: [
      {
        transformation: chain,
        format: "webp",
      },
    ],
    eager_async: false,
  }) as Promise<Record<string, any>>;
}

function shortError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.replace(/\s+/g, " ").trim().slice(0, 500) || "normalization_failed";
}

export async function normalizeProductImage(
  source: Buffer | string,
  options?: { folder?: string },
): Promise<ProductImageNormalizationResult> {
  const folder = options?.folder || "pro-cosmetics/products/originals";
  const uploaded = await uploadSource(source, folder);
  const originalUrl = String(uploaded.secure_url || "").trim();
  const publicId = String(uploaded.public_id || "").trim();

  if (!originalUrl || !publicId) {
    throw new Error("cloudinary_original_missing");
  }

  if (!productImageNormalizationEnabled()) {
    return {
      url: originalUrl,
      originalUrl,
      processedUrl: null,
      publicId,
      status: "NEEDS_REVIEW",
      error: "product_image_normalization_disabled",
      width: typeof uploaded.width === "number" ? uploaded.width : null,
      height: typeof uploaded.height === "number" ? uploaded.height : null,
    };
  }

  try {
    const explicit = await createCatalogDerivative(publicId);
    const processedUrl = String(explicit?.eager?.[0]?.secure_url || "").trim();

    if (!processedUrl) {
      return {
        url: originalUrl,
        originalUrl,
        processedUrl: null,
        publicId,
        status: "NEEDS_REVIEW",
        error: "normalized_image_url_missing",
        width: typeof uploaded.width === "number" ? uploaded.width : null,
        height: typeof uploaded.height === "number" ? uploaded.height : null,
      };
    }

    return {
      url: processedUrl,
      originalUrl,
      processedUrl,
      publicId,
      status: "PROCESSED",
      error: null,
      width: typeof uploaded.width === "number" ? uploaded.width : null,
      height: typeof uploaded.height === "number" ? uploaded.height : null,
    };
  } catch (error) {
    return {
      url: originalUrl,
      originalUrl,
      processedUrl: null,
      publicId,
      status: "NEEDS_REVIEW",
      error: shortError(error),
      width: typeof uploaded.width === "number" ? uploaded.width : null,
      height: typeof uploaded.height === "number" ? uploaded.height : null,
    };
  }
}
