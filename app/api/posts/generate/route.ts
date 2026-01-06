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
      slides: boolOrDefault(json.blocks?.slides, true),
      faq: boolOrDefault(json.blocks?.faq, true),
      checklist: boolOrDefault(json.blocks?.checklist, true),
      mistakes: boolOrDefault(json.blocks?.mistakes, true),
      table: boolOrDefault(json.blocks?.table, true),
    };

    // Блоки оформляем ТОЛЬКО через **...** (ваш рендер это понимает)
    const slidesRule = blocks.slides
      ? `В КАЖДОЙ секции добавляй подзаголовок **Слайд-выжимка** и 3–5 буллетов (коротко, 1 строка = 1 буллет).`
      : `Блок **Слайд-выжимка** не добавляй.`;

    const tableRule = blocks.table
      ? `Один раз в статье добавь **Таблица сравнения** и сразу после неё Markdown-таблицу с символами |. Таблица должна быть практической (3–5 строк сравнения).`
      : `Таблицу не добавляй.`;

    const mistakesRule = blocks.mistakes
      ? `Добавь блок **Ошибки и мифы** (минимум 7 пунктов списком "- ...").`
      : `Блок **Ошибки и мифы** не добавляй.`;

    const checklistRule = blocks.checklist
      ? `Добавь блок **Чек-лист** (10–15 коротких пунктов списком "- ...").`
      : `Блок **Чек-лист** не добавляй.`;

    const faqRule = blocks.faq
      ? `Добавь блок **FAQ** (8–12 вопросов; формат: "- **Вопрос?** ответ").`
      : `Блок **FAQ** не добавляй.`;

    // 5) Промпт: жестко фиксируем формат под ваш парсер (bold headings => TOC)
    const prompt = `
Ты — редактор и эксперт по уходу за кожей для интернет-магазина профессиональной косметики.
Сгенерируй насыщенную, структурированную статью, пригодную для публикации в блоге.

Тема: "${topic}"
Категория: "${category}"
Аудитория: "${audience}"
Тон: ${toneLabel(tone)}
Объём: ${depthSpec(depth)}

КРИТИЧНО (ОТВЕТ):
Верни ТОЛЬКО JSON и НИЧЕГО кроме JSON:
{
  "title": "...",
  "content": "...",
  "category": "..."
}

КРИТИЧНО (ФОРМАТ content для сайта):
- Запрещены заголовки вида "##" / "###" и любые "#".
- Запрещены разделители "---".
- Запрещён HTML.
- Заголовки разрешены ТОЛЬКО как отдельная строка целиком: **Текст заголовка**
- Запрещено писать одиночные строки типа "План", "Практика", "FAQ" без **...**.
- Лид НЕ оформляй заголовком. Лид — это 2–3 предложения обычным текстом в начале.
- Списки оформляй строго как "- пункт".
- Не упоминай ИИ/нейросети.

СТРОГАЯ СТРУКТУРА content (следуй ей):
1) Лид: 2–3 предложения обычным текстом (без заголовка).
2) Затем заголовок **План** и 6–10 пунктов списком.
   ВАЖНО: каждый пункт плана должен ТОЧНО совпадать с названием соответствующего заголовка ниже (буква-в-букву).

3) Далее 6–9 секций. Каждая секция имеет вид:

**Название секции**
- 3–6 тезисов списком
1–2 абзаца пояснения простым языком

**Практика**
- 3–6 шагов/рекомендаций (как выбрать / как применять / как сочетать)
${slidesRule}

4) ${tableRule}
5) ${mistakesRule}
6) ${checklistRule}
7) ${faqRule}

8) Заверши блоком:
**Вывод**
3–5 предложений + фраза: "Если остались вопросы — задайте их в Q&A на нашем сайте."

Содержательные требования:
- Практика важнее воды: больше критериев выбора, действий, предупреждений, комбинаций.
- Без диагнозов и лечебных обещаний.
- Если есть ограничения (беременность/ретиноиды/кислоты/чувствительность) — формулируй осторожно и советуй обратиться к специалисту.
`.trim();

    // 6) Вызов модели
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
      temperature: 0.55,
    });

    const raw = completion.choices[0]?.message?.content || "";

    // 7) Парсим JSON
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
    return NextResponse.json({ error: "server_error", message: msg }, { status: 500 });
  }
}
