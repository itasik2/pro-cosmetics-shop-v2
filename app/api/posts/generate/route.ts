// app/api/posts/generate/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
// сюда импортируешь своего клиента LLM
// import { openai } from "@/lib/openai";

export async function POST(req: Request) {
  const { topic, category } = await req.json().catch(() => ({}));

  if (!topic) {
    return NextResponse.json(
      { error: "topic_required" },
      { status: 400 },
    );
  }

  const prompt = `
Ты — эксперт по профессиональной косметике и уходу за кожей.
Сгенерируй полезную, понятную статью для блога интернет-магазина косметики.

Тема: "${topic}"
Категория (тип материала): "${category || "уход за кожей"}"

Составь JSON вида:
{
  "title": "...",
  "content": "...",
  "category": "..."
}

Требования:
- Язык: русский.
- Стиль: простой, понятный покупателю, без воды, без медицинских диагнозов.
- Не упоминай, что текст сгенерирован ИИ или нейросетью.
- Дай структурированный текст с подзаголовками (можно через ### в markdown).
`;

  // Псевдо-вызов LLM — тут ты подставляешь свой клиент
  const raw = `{
    "title": "Заголовок для темы ${topic}",
    "content": "Содержимое статьи про ${topic}...",
    "category": "${category || "уход за кожей"}"
  }`;

  // В реальном коде:
  // const response = await openai.chat.completions.create({ ...prompt... });
  // const raw = response.choices[0].message.content;

  let draft: any = {};
  try {
    draft = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: "llm_parse_error" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    title: draft.title || topic,
    content: draft.content || "",
    category: draft.category || category || "уход за кожей",
  });
}
