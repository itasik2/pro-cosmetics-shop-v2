// app/api/upload/product-image/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import { requireAdmin } from "@/lib/adminGuard";
import { normalizeProductImage } from "@/lib/productImageNormalization";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

function detectImageMime(bytes: Buffer): string | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  if (bytes.length >= 6) {
    const gif = bytes.toString("ascii", 0, 6);
    if (gif === "GIF87a" || gif === "GIF89a") return "image/gif";
  }

  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 4, 8) === "ftyp" &&
    ["avif", "avis"].includes(bytes.toString("ascii", 8, 12))
  ) {
    return "image/avif";
  }

  return null;
}

function uploadPurpose(req: Request, form: FormData) {
  const explicit = String(form.get("purpose") || "").trim().toLowerCase();
  if (explicit) return explicit;

  try {
    const referer = req.headers.get("referer");
    if (referer && new URL(referer).pathname.startsWith("/admin/products")) {
      return "product";
    }
  } catch {
    // Ignore malformed/missing Referer and keep generic upload behavior.
  }

  return "generic";
}

async function uploadGenericImage(bytes: Buffer) {
  return new Promise<any>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "pro-cosmetics/uploads",
        resource_type: "image",
        eager: [
          {
            width: 1200,
            crop: "limit",
            fetch_format: "auto",
            quality: "auto:good",
          },
        ],
        eager_async: false,
      },
      (err, res) => {
        if (err || !res) reject(err || new Error("upload_failed"));
        else resolve(res);
      },
    );

    stream.end(bytes);
  });
}

export async function POST(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      return NextResponse.json(
        { error: "cloudinary_not_configured" },
        { status: 500 },
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    const purpose = uploadPurpose(req, form);

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "file_required" }, { status: 400 });
    }

    const declaredType = file.type === "image/jpg" ? "image/jpeg" : file.type;
    if (!ALLOWED_IMAGE_TYPES.has(declaredType)) {
      return NextResponse.json(
        { error: "unsupported_image_type" },
        { status: 400 },
      );
    }

    const MAX_MB = 10;
    if (file.size <= 0 || file.size > MAX_MB * 1024 * 1024) {
      return NextResponse.json(
        { error: "file_too_large", maxMB: MAX_MB },
        { status: 400 },
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const detectedType = detectImageMime(bytes);
    if (!detectedType || detectedType !== declaredType) {
      return NextResponse.json(
        { error: "image_signature_mismatch" },
        { status: 400 },
      );
    }

    if (purpose === "product") {
      const normalized = await normalizeProductImage(bytes);
      return NextResponse.json(
        {
          url: normalized.url,
          originalUrl: normalized.originalUrl,
          processedUrl: normalized.processedUrl,
          processingStatus: normalized.status,
          processingError: normalized.error,
          publicId: normalized.publicId,
        },
        { status: 200 },
      );
    }

    const result = await uploadGenericImage(bytes);
    const optimizedUrl =
      result?.eager?.[0]?.secure_url || result?.secure_url || "";

    if (!optimizedUrl) {
      return NextResponse.json({ error: "no_url_returned" }, { status: 500 });
    }

    return NextResponse.json(
      {
        url: optimizedUrl,
        originalUrl: result?.secure_url,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("PRODUCT IMAGE UPLOAD ERROR", error);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }
}
