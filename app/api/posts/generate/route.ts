// app/api/posts/generate/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import { requireAdmin } from "@/lib/adminGuard";

type Body = {
  topic?: string;
  category?: string;

  audience?: string;
  tone?: "neutral" | "simple" | "expert" | "marketing";
  depth?: "short" | "standard" | "deep";

  blocks?: {
    faq?: boolean;
    checklist?: boolean;
    mistakes?: boolean;
    // table?: boolean; // УДАЛЕНО
  };
};

function toneLabel(tone: Body["tone"]) {
  switch (tone) {
    case "simple":
      return "простыми словами, без сложной терминологии, без воды";
    case "neutral":
      return "нейтрально и делово, по делу";
    case "marketing":
      return "мягко-маркетингово, но без давления и без обещаний чудес";
    case "expert":
    default:
      return "экспертно, но понятно, без медицины и без диагнозов";
  }
}

function depthSpec(depth: Body["depth"]) {
  switch (depth) {
    case "short":
      return "700–1000 слов";
    case "standard":
      return "1000–1500 слов";
    case "deep":
    default:
      return "1500–2200 слов, максимально насыщенно";
  }
}

function boolOrDefault(v: unknown, def: boolean) {
  return typeof v === "boolean" ? v : def;
}

function extractJsonFromText(raw: string) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return null;

  const slice = raw.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const forbidden = await requireAdmin();
    if (forbidden) return forbidden;

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "no_api_key" }, { status: 500 });
    }

    const json = (await req.json().catch(() => ({}))) as Body;

    const topic = (json.topic || "").trim();
    const category = (json.category || "").trim() || "уход за кожей";
    if (!topic) {
      return NextResponse.json({ error: "topic_required" }, { status: 400 });
    }

    const audience = (json.audience || "широкая аудитория").trim() || "широкая аудитория";
    const tone = (json.tone || "expert") as NonNullable<Body["tone"]>;
    const depth = (json.depth || "deep") as NonNullable<Body["depth"]>;

    const blocks = {
      faq: boolOrDefault(json.blocks?.faq, true),
      checklist: boolOrDefault(json.blocks?.checklist, true),
      mistakes: boolOrDefault(json.blocks?.mistakes, true),
    };

    const faqRule = blocks.faq
      ? `Добавь отдельный раздел **FAQ** (8–12 пар). Формат КАЖДОЙ пары строго такой:
**Вопрос?**
Ответ обычным текстом со следующей строки.
Никаких "Вопрос:"/"Ответ:" и не в одну строку. Между парами — пустая строка.`
      : `FAQ не добавляй.`;

    const mistakesRule = blocks.mistakes
      ? `Добавь отдельный раздел **Ошибки и мифы** (минимум 7 пунктов).`
      : `Ошибки/мифы не добавляй.`;

    const checklistRule = blocks.checklist
      ? `Добавь отдельный раздел **Чек-лист** (10–15 коротких пунктов).`
      : `Чек-лист не добавляй.`;

    const prompt = `
Ты — редактор и эксперт по уходу за кожей для интернет-магазина профессиональной косметики.
Сгенерируй насыщенную, структурированную статью, которую легко читать.

Тема: "${topic}"
Категория: "${category}"
Аудитория: "${audience}"
Тон: ${toneLabel(tone)}
Объём: ${depthSpec(depth)}

КРИТИЧНО:
- Верни ответ строго в виде JSON, без пояснений и без текста вне JSON:
{
  "title": "...",
  "content": "...",
  "category": "..."
}

Форматирование:
- НЕ используй Markdown-заголовки вида "#", "##", "###".
- НЕ используй разделители "---".
- НЕ используй слова "План", "Содержание", "Лид" как отдельные строки/заголовки.
- Каждый заголовок секции пиши отдельной строкой строго в виде: **Текст заголовка**
- Начни статью с 2–3 предложений вводного текста БЕЗ заголовка (просто абзац).
- Списки оформляй как "- пункт".
- Никаких упоминаний ИИ/нейросетей.

Структура:
1) Вводный абзац (2–3 предложения), без заголовка.
2) Далее 6–9 смысловых разделов, каждый содержит:
   - заголовок **...**
   - 3–6 тезисов списком ИЛИ 1–2 абзаца (можно комбинировать)
   - как выбрать / как применять / как сочетать / на что обратить внимание

3) ${mistakesRule}
4) ${checklistRule}
5) ${faqRule}
6) Заверши разделом **Вывод** (кратко + предложение задать вопрос в Q&A на сайте)

Содержательные требования:
- Практика важнее воды: больше шагов, критериев выбора, предупреждений, комбинаций.
- Без медицинских диагнозов и лечебных обещаний.
- Если есть ограничения (беременность/ретиноиды/кислоты/чувствительность) — формулируй как осторожность и общий совет обратиться к специалисту.
`.trim();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Ты пишешь статьи для блога магазина профессиональной косметики. Всегда возвращаешь строго JSON, без текста вне JSON.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.65,
    });

    const raw = completion.choices[0]?.message?.content || "";

    const parsed = extractJsonFromText(raw);
    if (!parsed) {
      return NextResponse.json({ error: "llm_parse_error", raw }, { status: 500 });
    }

    const title =
      typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : topic;

    const content = typeof parsed.content === "string" ? parsed.content.trim() : "";

    const outCategory =
      typeof parsed.category === "string" && parsed.category.trim()
        ? parsed.category.trim()
        : category;

    if (!content) {
      return NextResponse.json({ error: "llm_empty_content", raw }, { status: 500 });
    }

    return NextResponse.json({ title, content, category: outCategory });
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    const msg = err?.message || "unknown";

    if (status === 429 || String(msg).includes("exceeded your current quota")) {
      return NextResponse.json(
        {
          error: "quota_exceeded",
          message:
            "Закончилась квота OpenAI (429). Проверь план/биллинг и лимиты в OpenAI Platform.",
        },
        { status: 429 },
      );
    }

    console.error("POST /api/posts/generate error:", err);
    return NextResponse.json({ error: "server_error", message: msg }, { status: 500 });
  }
}
