// app/api/posts/generate-cover/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import { v2 as cloudinary } from "cloudinary";
import { requireAdmin } from "@/lib/adminGuard";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

type Body = {
  topic?: string;
  category?: string;
};

function pickStyle(category: string) {
  const c = (category || "").toLowerCase();
  if (c.includes("акне") || c.includes("проблем")) return "clean clinical skincare";
  if (c.includes("новост")) return "minimal editorial";
  if (c.includes("уход")) return "premium minimal skincare";
  return "premium minimal skincare";
}

export async function POST(req: Request) {
  try {
    const forbidden = await requireAdmin();
    if (forbidden) return forbidden;

    // cloudinary env
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      return NextResponse.json({ error: "cloudinary_not_configured" }, { status: 500 });
    }

    // вход
    const json = (await req.json().catch(() => ({}))) as Body;
    const topic = (json.topic || "").trim();
    const category = (json.category || "").trim();

    if (!topic) {
      return NextResponse.json({ error: "topic_required" }, { status: 400 });
    }

    // prompt: делаем безопасный, без брендов/логотипов
    const style = pickStyle(category);
    const prompt = `
Minimal, premium skincare blog cover image.
Theme: "${topic}".
Style: ${style}. Soft background, product-agnostic, no text, no logos, no watermark.
High quality, modern, clean composition, suitable for cosmetics e-commerce blog.
`.trim();

    // Генерация изображения (типовой вызов OpenAI Images API)
    // Если ваш SDK не поддерживает openai.images.generate — адаптируйте на свою версию.
    const img = await (openai as any).images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1536x1024",
    });

    const b64 = img?.data?.[0]?.b64_json as string | undefined;
    if (!b64) {
      return NextResponse.json({ error: "image_generation_failed" }, { status: 500 });
    }

    const bytes = Buffer.from(b64, "base64");

    // Upload в Cloudinary
    const uploaded = await new Promise<any>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "pro-cosmetics/blog",
          resource_type: "image",
          eager: [
            {
              width: 1600,
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

    const optimizedUrl = uploaded?.eager?.[0]?.secure_url || uploaded?.secure_url || "";
    if (!optimizedUrl) {
      return NextResponse.json({ error: "no_url_returned" }, { status: 500 });
    }

    return NextResponse.json({ url: optimizedUrl }, { status: 200 });
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    const msg = err?.message || "unknown";

    if (status === 429 || String(msg).includes("exceeded your current quota")) {
      return NextResponse.json(
        { error: "quota_exceeded", message: "Закончилась квота OpenAI (429)." },
        { status: 429 }
      );
    }

    console.error("POST /api/posts/generate-cover error:", err);
    return NextResponse.json({ error: "server_error", message: msg }, { status: 500 });
  }
}
