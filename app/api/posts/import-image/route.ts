export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";

const ImportSchema = z.object({ url: z.string().url() });

function isAllowedCommonsImage(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "https:" &&
      url.hostname === "upload.wikimedia.org" &&
      url.pathname.startsWith("/wikipedia/commons/")
    );
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    return NextResponse.json({ error: "cloudinary_not_configured" }, { status: 500 });
  }

  const parsed = ImportSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success || !isAllowedCommonsImage(parsed.data?.url || "")) {
    return NextResponse.json({ error: "invalid_image_url" }, { status: 400 });
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  try {
    const uploaded = await cloudinary.uploader.upload(parsed.data.url, {
      folder: "pro-cosmetics/blog",
      resource_type: "image",
      eager: [{ width: 1600, crop: "limit", fetch_format: "auto", quality: "auto:good" }],
      eager_async: false,
    });
    const url = uploaded.eager?.[0]?.secure_url || uploaded.secure_url || "";
    if (!url) return NextResponse.json({ error: "no_url_returned" }, { status: 500 });
    return NextResponse.json({ url });
  } catch (error) {
    console.error("POST /api/posts/import-image error:", error);
    return NextResponse.json({ error: "image_import_failed" }, { status: 502 });
  }
}
