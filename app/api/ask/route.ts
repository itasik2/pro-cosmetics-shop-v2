import { prisma } from "@/lib/prisma";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const { query } = await req.json();
  if (!query || query.length < 3) return new Response("Query too short", { status: 400 });

  // naive retrieval
  const [products, posts] = await Promise.all([
    prisma.product.findMany({ take: 8 }),
    prisma.post.findMany({ take: 8 }),
  ]);

  const context = [
    ...products.map(p => `ТОВАР: ${p.name} (${p.brand}) — ${p.description}`),
    ...posts.map(a => `СТАТЬЯ: ${a.title} — ${a.content.slice(0, 600)}`),
  ].join("\n\n");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({
      answer: "ИИ не настроен (нет OPENAI_API_KEY). Добавьте ключ и повторите вопрос.",
      usedContext: context.slice(0, 1500)
    });
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Ты консультант по косметике/фитопродукции. Отвечай кратко, точно, с оговорками по безопасности. Если нет данных, говори честно." },
        { role: "user", content: `Вопрос: ${query}\n\nКонтекст:\n${context}` }
      ],
      temperature: 0.2
    })
  });
  const data = await res.json();
  const answer = data?.choices?.[0]?.message?.content ?? "Не удалось получить ответ.";
  return Response.json({ answer });
}
