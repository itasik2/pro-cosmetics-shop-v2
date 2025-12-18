// app/api/posts/generate/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { openai } from "@/lib/openai";

const InputSchema = z.object({
  topic: z.string().min(3),
  category: z.string().optional(),
});

export async function POST(req: Request) {
  // только админ
  const session = await auth();
  const adminEmail = (process.env.AUTH_ADMIN_EMAIL || "").toLowerCase();

  if (!session?.user?.email || session.user.email.toLowerCase() !== adminEmail) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // читаем и валидируем вход
  const json = await req.json().catch(() => ({}));
  const parse = InputSchema.safeParse(json);

  if (!parse.success) {
    return NextResponse.json(
      { error: "topic_required", issues: parse.error.issues },
      { status: 400 },
    );
  }

  const { topic, category } = parse.data;

  const prompt = `
Ты — эксперт по профессиональной косметике и уходу за кожей.
Сгенерируй полезную, понятную статью для блога интернет-магазина косметики.

Тема: "${topic}"
Категория (тип материала): "${category || "уход за кожей"}"

Верни ответ строго в формате JSON:
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

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini", // при желании можешь заменить на другой доступный
      messages: [
        {
          role: "system",
          content: "Ты помощник, который пишет статьи для блога магазина профессиональной косметики.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
    });

    const raw = completion.choices[0]?.message?.content || "";

    // выдёргиваем JSON из ответа
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
    } catch (e) {
      return NextResponse.json(
        { error: "llm_invalid_json", raw },
        { status: 500 },
      );
    }

    // нормализуем результат
    const title = typeof parsed.title === "string" && parsed.title.trim()
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
  } catch (e: any) {
    console.error("AI POST GENERATE ERROR:", e);
    return NextResponse.json(
      { error: "generation_failed", message: e?.message },
      { status: 500 },
    );
  }
}
