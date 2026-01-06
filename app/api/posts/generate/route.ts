// app/api/posts/generate/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { openai } from "@/lib/openai";

type Body = {
  topic?: string;
  category?: string;

  // новые опции (все необязательные, чтобы не ломать старые вызовы)
  audience?: string;
  tone?: "neutral" | "simple" | "expert" | "marketing";
  depth?: "short" | "standard" | "deep";

  blocks?: {
    slides?: boolean;
    faq?: boolean;
    checklist?: boolean;
    mistakes?: boolean;
    table?: boolean;
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
    const category = (json.category || "").trim() || "уход за кожей";

    if (!topic) {
      return NextResponse.json({ error: "topic_required" }, { status: 400 });
    }

    // 4) Дефолты (чтобы старые вызовы работали)
    const audience = (json.audience || "широкая аудитория").trim() || "широкая аудитория";
    const tone = (json.tone || "expert") as NonNullable<Body["tone"]>;
    const depth = (json.depth || "deep") as NonNullable<Body["depth"]>;

    const blocks = {
      // по умолчанию включаем “насыщение”
      slides: boolOrDefault(json.blocks?.slides, true),
      faq: boolOrDefault(json.blocks?.faq, true),
      checklist: boolOrDefault(json.blocks?.checklist, true),
      mistakes: boolOrDefault(json.blocks?.mistakes, true),
      table: boolOrDefault(json.blocks?.table, true),
    };

    const slideRule = blocks.slides
      ? `Перед КАЖДЫМ разделом ставь строку-делитель '---' на отдельной строке.`
      : `Разделители '---' не используй.`;

    const tableRule = blocks.table
      ? `Добавь 1 таблицу в Markdown (с символами |), практическую: сравнение вариантов/сценариев применения/комбинаций.`
      : `Таблицу не добавляй.`;

    const faqRule = blocks.faq
      ? `Добавь блок "## FAQ" (8–12 вопросов и коротких ответов).`
      : `FAQ не добавляй.`;

    const mistakesRule = blocks.mistakes
      ? `Добавь блок "## Ошибки и мифы" (минимум 7 пунктов).`
      : `Ошибки/мифы не добавляй.`;

    const checklistRule = blocks.checklist
      ? `Добавь блок "## Чек-лист" (10–15 коротких пунктов).`
      : `Чек-лист не добавляй.`;

    // 5) Промпт (богатый, структурный, пригодный для /slides)
    // Важно: просим ВЕРНУТЬ JSON и ничего кроме JSON.
    const prompt = `
Ты — редактор и эксперт по уходу за кожей для интернет-магазина профессиональной косметики.
Сгенерируй насыщенную, структурированную статью, которую легко читать и легко превращать в презентацию.

Тема: "${topic}"
Категория: "${category}"
Аудитория: "${audience}"
Тон: ${toneLabel(tone)}
Объём: ${depthSpec(depth)}

КРИТИЧНО:
- Верни ответ строго в виде JSON, без пояснений, без текста вне JSON:
{
  "title": "...",
  "content": "...",
  "category": "..."
}

Формат content:
- Только обычный текст + Markdown-разметка (без HTML).
- Разделы оформляй заголовками вида "## ...".
- ${slideRule}
- Списки оформляй как "- пункт".
- Никаких упоминаний ИИ/нейросетей.

Структура статьи:
1) Короткий "Лид" (2–3 предложения)
2) "План" (6–10 пунктов)
3) Далее 6–9 разделов "## ..." (каждый раздел содержит):
   - 3–6 тезисов списком
   - 1–2 абзаца пояснения
   - мини-пример/пошаговые действия (как применять / как выбрать / как сочетать)
4) ${tableRule}
5) ${mistakesRule}
6) ${checklistRule}
7) ${faqRule}
8) Заверши "## Вывод" (кратко + предложение задать вопрос в Q&A на сайте)

Содержательные требования:
- Практика важнее воды: больше шагов, критериев выбора, предупреждений, комбинаций.
- Без медицинских диагнозов и лечебных обещаний.
- Если есть ограничения (беременность/ретиноиды/кислоты/чувствительность) — формулируй как осторожность и общий совет обратиться к специалисту.
`.trim();

    // 6) Вызов модели (оставляем ваш openai wrapper)
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

    // 7) Парсим JSON (надёжнее: отдельная функция)
    const parsed = extractJsonFromText(raw);
    if (!parsed) {
      return NextResponse.json(
        { error: "llm_parse_error", raw },
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
        : category;

    if (!content) {
      return NextResponse.json(
        { error: "llm_empty_content", raw },
        { status: 500 },
      );
    }

    return NextResponse.json({
      title,
      content,
      category: outCategory,
    });
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
    return NextResponse.json(
      { error: "server_error", message: msg },
      { status: 500 },
    );
  }
}
