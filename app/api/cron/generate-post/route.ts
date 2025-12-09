// app/api/cron/generate-post/route.ts
export const runtime = "nodejs";
export const revalidate = 0;

import { prisma } from "@/lib/prisma";

type ChatChoice = { message?: { content?: string } };
type ChatResponse = { choices?: ChatChoice[] };

export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return new Response("Missing OPENAI_API_KEY", { status: 400 });

  const topics = ["новинки ухода", "натуральные масла", "советы дерматологов", "фиточаи и сборы"];
  const topic = topics[Math.floor(Math.random() * topics.length)];
  const prompt =
    `Напиши блог-пост 250-400 слов по теме: "${topic}". ` +
    `Тон спокойный, без навязчивых обещаний. Структура: заголовок, 2-3 абзаца, краткие выводы.`;

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6
    })
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return new Response(`LLM HTTP ${r.status}: ${text}`, { status: 502 });
  }

  const data = (await r.json()) as ChatResponse;
  const content = data?.choices?.[0]?.message?.content ?? null;
  if (!content) return new Response("LLM error: empty content", { status: 500 });

  // Возьмём первую непустую строку как заголовок
  const firstLine = content.split(/\r?\n/).find((l: string) => l.trim().length > 0) ?? "";
 const contentStr: string = String(content);
  const title =
    contentStr
      .split(/\r?\n/)
      .find((l: string) => l.trim().length > 0)
      ?.replace(/^#+\s*/, "")
      ?.slice(0, 100) || `Пост о теме: ${topic}`;

  // Аккуратный slug: буквы/цифры (латиница+кириллица), дефисы
  const base = title
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/giu, "-")
    .replace(/^-+|-+$/g, "");
  const slug = `${base || "novyy-post"}-${Math.floor(Date.now() / 1000)}`;

  try {
    await prisma.post.create({
      data: { title, slug, content, category: "авто", image: "/seed/post1.jpg" }
    });
    return Response.json({ ok: true, slug });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return new Response("slug_exists", { status: 409 });
    }
    console.error("CREATE POST ERROR:", e);
    return new Response("failed_to_create_post", { status: 500 });
  }
}
