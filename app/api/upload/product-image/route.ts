// app/api/upload/product-image/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import { requireAdmin } from "@/lib/adminGuard";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

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
        { status: 500 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "file_required" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "only_images_allowed" }, { status: 400 });
    }

    // (опционально) ограничение размера файла, например 10MB
    const MAX_MB = 10;
    if (file.size > MAX_MB * 1024 * 1024) {
      return NextResponse.json(
        { error: "file_too_large", maxMB: MAX_MB },
        { status: 400 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    const result = await new Promise<any>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "pro-cosmetics/products",
          resource_type: "image",

          // Создаём оптимизированную производную сразу (и вернём именно её URL)
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
        }
      );

      stream.end(bytes);
    });

    // Берём оптимизированную версию (если Cloudinary вернул eager)
    const optimizedUrl =
      result?.eager?.[0]?.secure_url || result?.secure_url || "";

    if (!optimizedUrl) {
      return NextResponse.json({ error: "no_url_returned" }, { status: 500 });
    }

    return NextResponse.json(
      {
        url: optimizedUrl,
        originalUrl: result?.secure_url, // на всякий случай
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }
}
