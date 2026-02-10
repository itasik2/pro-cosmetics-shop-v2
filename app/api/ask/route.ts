import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (ip) {
    const rl = checkRateLimit(`ask:${ip}`, 12, 60_000);
    if (!rl.ok) {
      return new Response("Too many requests", {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSec) },
      });
    }
  }

  const { query } = await req.json();

  if (!query || String(query).trim().length < 3) {
    return new Response("Query too short", { status: 400 });
  }

  // naive retrieval
  const [products, posts] = await Promise.all([
    prisma.product.findMany({
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
      (p) =>
        `ТОВАР: ${p.name}${p.brand?.name ? ` (${p.brand.name})` : ""} — ${p.description}`,
    ),
    ...posts.map(
      (a) => `СТАТЬЯ: ${a.title} — ${a.content.slice(0, 600)}`,
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

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
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

  const data = await res.json().catch(() => ({} as any));
  const answer =
    data?.choices?.[0]?.message?.content ??
    "Не удалось получить ответ.";

  return Response.json({ answer });
}
