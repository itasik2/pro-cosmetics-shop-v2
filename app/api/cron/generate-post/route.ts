import { prisma } from "@/lib/prisma";
export const runtime = "nodejs";

export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return new Response("Missing OPENAI_API_KEY", { status: 400 });

  const topics = ["новинки ухода", "натуральные масла", "советы дерматологов", "фиточаи и сборы"];
  const topic = topics[Math.floor(Math.random()*topics.length)];
  const prompt = `Напиши блог‑пост 250-400 слов по теме: "${topic}". Тон спокойный, без навязчивых обещаний. Структура: заголовок, 2-3 абзаца, краткие выводы.`;

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6
    })
  });
  const data = await r.json();
  const content = data?.choices?.[0]?.message?.content ?? null;
  if (!content) return new Response("LLM error", { status: 500 });

  const title = content.split("\n").find(l=>l.trim().length>0)?.replace(/^#+\s*/, "")?.slice(0, 100) || `Пост о теме: ${topic}`;
  const slug = (title.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-").replace(/^-+|-+$/g,"") || "novyy-post") + "-" + Math.floor(Date.now()/1000);

  await prisma.post.create({ data: { title, slug, content, category: "авто", image: "/seed/post1.jpg" } });
  return Response.json({ ok: true, slug });
}
