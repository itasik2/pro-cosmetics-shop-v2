// app/api/posts/generate/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { openai } from "@/lib/openai";

type Body = {
  topic?: string;
  category?: string;
};

export async function POST(req: Request) {
  try {
    // 1) Пускаем только админа
    const session = await auth();
    const adminEmail = (process.env.AUTH_ADMIN_EMAIL || "").toLowerCase();

    if (!session?.user?.email || session.user.email.toLowerCase() !== adminEmail) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // 2) Проверка ключа
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "no_api_key" }, { status: 500 });
    }

    // 3) Читаем вход
    const json = (await req.json().catch(() => ({}))) as Body;
    const topic = (json.topic || "").trim();
    const category = (json.category || "").trim();

    if (!topic) {
      return NextResponse.json({ error: "topic_required" }, { status: 400 });
    }

    // 4) Промпт
    const prompt = `
Ты — эксперт по профессиональной косметике и уходу за кожей.
Сгенерируй полезную, понятную статью для блога интернет-магазина косметики.

Тема: "${topic}"
Категория (тип материала): "${category || "уход за кожей"}"

Верни ответ строго в виде JSON:
{
  "title": "...",
  "content": "...",
  "category": "..."
}

Требования к статье:
- Язык: русский.
- Стиль: простой, понятный покупателю, без воды и сложной медицины.
- Не упоминай, что текст сгенерирован ИИ или нейросетью.
- Структурируй текст с подзаголовками (используй '### Подзаголовок' в тексте).
- Можно давать практические советы и пошаговые рекомендации.
`.trim();

    // 5) Вызов модели
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // безопасная универсальная модель
      messages: [
        {
          role: "system",
          content:
            "Ты помощник, который пишет статьи для блога магазина профессиональной косметики.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
    });

    const raw = completion.choices[0]?.message?.content || "";

    // 6) Вытаскиваем JSON из ответа
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) {
      return NextResponse.json(
        { error: "llm_parse_error", raw },
        { status: 500 },
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return NextResponse.json(
        { error: "llm_invalid_json", raw },
        { status: 500 },
      );
    }

    const title =
      typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim()
        : topic;
    const content =
      typeof parsed.content === "string" ? parsed.content.trim() : "";
    const outCategory =
      typeof parsed.category === "string" && parsed.category.trim()
        ? parsed.category.trim()
        : category || "уход за кожей";

    return NextResponse.json({
      title,
      content,
      category: outCategory,
    });
  } catch (err: any) {
    console.error("POST /api/posts/generate error:", err);
    return NextResponse.json(
      { error: "server_error", message: err?.message || "unknown" },
      { status: 500 },
    );
  }
}
