import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

type AskHistoryItem = {
  role?: unknown;
  text?: unknown;
};

type AskBody = {
  query?: unknown;
  context?: {
    productId?: unknown;
  } | null;
  history?: AskHistoryItem[];
};

const INGREDIENT_HEADING = "Состав и активные компоненты";
const OTHER_SECTION_HEADINGS = [
  "Для какой кожи",
  "Для каких задач",
  "Преимущества",
  "Почему удобно",
  "Способ применения",
  "Важно",
];

function asksAboutIngredients(query: string) {
  return /(?:состав|ингредиент|inci|активн(?:ый|ые|ого|ых)?\s+(?:компонент|веществ)|компонент(?:ы|ов)?|что\s+входит|содержит)/iu.test(
    query,
  );
}

function descriptionBlocks(value: unknown) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function publicDescription(value: unknown) {
  return descriptionBlocks(value)
    .filter(
      (block) =>
        !block.toLocaleLowerCase("ru-RU").startsWith(
          INGREDIENT_HEADING.toLocaleLowerCase("ru-RU"),
        ),
    )
    .join("\n\n")
    .trim();
}

function ingredientsFromStoredDescription(value: unknown) {
  const text = String(value || "").replace(/\r\n?/g, "\n");
  const lower = text.toLocaleLowerCase("ru-RU");
  const heading = INGREDIENT_HEADING.toLocaleLowerCase("ru-RU");
  const start = lower.indexOf(heading);
  if (start < 0) return "";

  const contentStart = start + INGREDIENT_HEADING.length;
  let end = text.length;
  for (const nextHeading of OTHER_SECTION_HEADINGS) {
    const index = lower.indexOf(
      nextHeading.toLocaleLowerCase("ru-RU"),
      contentStart,
    );
    if (index >= contentStart && index < end) end = index;
  }

  return text
    .slice(contentStart, end)
    .replace(/^\s*[:\n-]+/u, "")
    .trim();
}

function cleanHistory(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ role: "user" | "assistant"; text: string }>;
  return value
    .slice(-8)
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as AskHistoryItem;
      const role = row.role === "assistant" ? "assistant" : row.role === "user" ? "user" : null;
      const text = String(row.text || "").trim().slice(0, 1500);
      return role && text ? [{ role, text }] : [];
    });
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (ip) {
    const rateLimit = checkRateLimit(`ask:${ip}`, 12, 60_000);
    if (!rateLimit.ok) {
      return new Response("Too many requests", {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSec) },
      });
    }
  }

  const body = (await req.json().catch(() => ({}))) as AskBody;
  const query = String(body.query || "").trim();
  const productId = String(body.context?.productId || "").trim();
  const ingredientQuestion = asksAboutIngredients(query);
  const history = cleanHistory(body.history);

  if (query.length < 3) {
    return new Response("Query too short", { status: 400 });
  }

  const targetProduct = productId
    ? await prisma.product.findFirst({
        where: { id: productId, isPublished: true },
        include: {
          brand: true,
          enrichmentProposals: {
            where: { status: "APPLIED" },
            orderBy: { appliedAt: "desc" },
            take: 1,
            select: { ingredients: true, sourceUrl: true },
          },
        },
      })
    : null;

  const [products, posts] = await Promise.all([
    targetProduct
      ? Promise.resolve([])
      : prisma.product.findMany({
          where: { isPublished: true },
          take: 8,
          include: { brand: true },
          orderBy: { createdAt: "desc" },
        }),
    prisma.post.findMany({
      take: targetProduct ? 4 : 8,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const contextParts: string[] = [];

  if (targetProduct) {
    contextParts.push(
      `ТОВАР: ${targetProduct.name}${
        targetProduct.brand?.name ? ` (${targetProduct.brand.name})` : ""
      } — ${publicDescription(targetProduct.description)}`,
    );

    if (ingredientQuestion) {
      const proposalIngredients =
        targetProduct.enrichmentProposals[0]?.ingredients?.trim() || "";
      const storedIngredients = ingredientsFromStoredDescription(
        targetProduct.description,
      );
      const ingredients = proposalIngredients || storedIngredients;
      contextParts.push(
        ingredients
          ? `ПОДТВЕРЖДЁННЫЙ СОСТАВ/АКТИВНЫЕ КОМПОНЕНТЫ ДЛЯ ЭТОГО ТОВАРА: ${ingredients}`
          : "ПОДТВЕРЖДЁННЫЙ СОСТАВ ДЛЯ ЭТОГО ТОВАРА В КАТАЛОГЕ НЕ СОХРАНЁН.",
      );
    }
  } else {
    contextParts.push(
      ...products.map(
        (product) =>
          `ТОВАР: ${product.name}${
            product.brand?.name ? ` (${product.brand.name})` : ""
          } — ${publicDescription(product.description)}`,
      ),
    );
  }

  contextParts.push(
    ...posts.map(
      (post) => `СТАТЬЯ: ${post.title} — ${post.content.slice(0, 600)}`,
    ),
  );

  const context = contextParts.join("\n\n");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({
      answer:
        "ИИ не настроен (нет OPENAI_API_KEY). Добавьте ключ и повторите вопрос.",
      usedContext: context.slice(0, 1500),
    });
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_ASK_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: [
            "Ты консультант по косметике и фитопродукции. Отвечай кратко и точно, с оговорками по безопасности. Если данных нет, говори честно.",
            "Не перечисляй состав, INCI и активные компоненты по собственной инициативе. Используй сведения о составе только если пользователь прямо спрашивает о составе, ингредиентах или активных компонентах.",
            "Если пользователь спрашивает о составе, используй только подтверждённый состав из контекста и не дополняй его догадками.",
          ].join(" "),
        },
        ...history.map((item) => ({
          role: item.role,
          content: item.text,
        })),
        {
          role: "user",
          content: `Вопрос: ${query}\n\nКонтекст:\n${context}`,
        },
      ],
      temperature: 0.2,
    }),
  });

  const data = await response.json().catch(() => ({} as any));
  const answer =
    data?.choices?.[0]?.message?.content ?? "Не удалось получить ответ.";

  return Response.json({ answer });
}
