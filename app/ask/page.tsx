"use client";
import { useState } from "react";

export default function AskPage() {
  const [q, setQ] = useState("");
  const [a, setA] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask() {
    setLoading(true); setA(null);
    const res = await fetch("/api/ask", { method: "POST", body: JSON.stringify({ query: q }) });
    const data = await res.json();
    setLoading(false);
    setA(data.answer || data.note || "Нет ответа");
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Вопрос‑ответ</h1>
      <p className="text-sm text-gray-600">Спроси про продукт, состав, совместимость. Я отвечу на основе каталога и блога.</p>
      <div className="card space-y-3">
        <input className="w-full border rounded-xl px-3 py-2" value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Например: можно ли это масло при чувствительной коже?"/>
        <button className="btn" onClick={ask} disabled={loading || q.length < 3}>
          {loading ? "Думаю..." : "Спросить"}
        </button>
      </div>
      {a && <div className="card whitespace-pre-line">{a}</div>}
    </div>
  );
}
