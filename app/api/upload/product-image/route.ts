// app/api/upload/product-image/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

export async function POST(req: Request) {
  try {
    // Проверка ENV
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

    // простая валидация по типу
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "only_images_allowed" }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "pro-cosmetics/products",
          resource_type: "image",
        },
        (err, res) => {
          if (err || !res) reject(err || new Error("upload_failed"));
          else resolve(res as any);
        }
      );

      stream.end(bytes);
    });

    return NextResponse.json({ url: result.secure_url }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }
}