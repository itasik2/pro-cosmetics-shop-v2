import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

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

  const body = (await req.json().catch(() => ({}))) as { query?: unknown };
  const query = String(body.query || "").trim();

  if (query.length < 3) {
    return new Response("Query too short", { status: 400 });
  }

  const [products, posts] = await Promise.all([
    prisma.product.findMany({
      where: { isPublished: true },
      take: 8,
      include: { brand: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.post.findMany({
      take: 8,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const context = [
    ...products.map(
      (product) =>
        `ТОВАР: ${product.name}${product.brand?.name ? ` (${product.brand.name})` : ""} — ${product.description}`,
    ),
    ...posts.map(
      (post) => `СТАТЬЯ: ${post.title} — ${post.content.slice(0, 600)}`,
    ),
  ].join("\n\n");

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
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Ты консультант по косметике/фитопродукции. Отвечай кратко, точно, с оговорками по безопасности. Если нет данных, говори честно.",
        },
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
