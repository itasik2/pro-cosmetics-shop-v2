// app/ask/AskClient.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type ProductCtx = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  brand?: { name?: string } | null;
};

type ChatMsg =
  | { id: string; role: "user"; text: string; ts: number }
  | { id: string; role: "assistant"; text: string; ts: number };

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function fetchProduct(productId: string): Promise<ProductCtx | null> {
  try {
    const res = await fetch(`/api/products/${encodeURIComponent(productId)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const p = await res.json();
    if (!p?.id) return null;
    return p as ProductCtx;
  } catch {
    return null;
  }
}

export default function AskClient() {
  const sp = useSearchParams();
  const productId = (sp.get("productId") || "").trim();

  const [product, setProduct] = useState<ProductCtx | null>(null);

  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const [msgs, setMsgs] = useState<ChatMsg[]>([]);

  // refs for focus/scroll
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastAssistantRef = useRef<HTMLDivElement | null>(null);

  // textarea autoresize
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!productId) {
        setProduct(null);
        return;
      }
      const p = await fetchProduct(productId);
      if (!cancelled) setProduct(p);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const suggestedPrompt = useMemo(() => {
    if (!product) return "";
    const brand = product.brand?.name ? `${product.brand.name} • ` : "";
    return `Вопрос по товару: ${product.name}
${brand}${Number(product.price).toLocaleString("ru-RU")} ₸
Категория: ${product.category}

Мой вопрос: `;
  }, [product]);

  // Префилл (только если поле пустое и нет истории)
  useEffect(() => {
    if (product && !q.trim() && msgs.length === 0) {
      setQ(suggestedPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  // Автоскролл вниз по новым сообщениям/загрузке
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs.length, loading]);

  // После прихода ответа: фокус на последнем ответе (assistant)
  useEffect(() => {
    const last = msgs[msgs.length - 1];
    if (!last) return;
    if (last.role !== "assistant") return;

    // небольшой микротаймаут чтобы DOM успел отрисоваться
    const t = window.setTimeout(() => {
      lastAssistantRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      lastAssistantRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(t);
  }, [msgs]);

  // autoresize textarea (min 2 строки, max ~8 строк)
  const resizeTextarea = () => {
    const el = taRef.current;
    if (!el) return;

    el.style.height = "auto";

    const maxPx = 8 * 24; // ~8 строк по 24px (с запасом)
    const next = Math.min(el.scrollHeight, maxPx);

    el.style.height = `${next}px`;
  };

  useEffect(() => {
    resizeTextarea();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function ask() {
    const query = q.trim();
    if (query.length < 3 || loading) return;

    setLoading(true);

    const userMsg: ChatMsg = { id: uid(), role: "user", text: query, ts: Date.now() };
    setMsgs((m) => [...m, userMsg]);

    const context = product
      ? {
          productId: product.id,
          name: product.name,
          brand: product.brand?.name || "",
          category: product.category,
          price: product.price,
          description: product.description,
        }
      : null;

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          context,
          history: msgs.slice(-8).map((m) => ({ role: m.role, text: m.text })),
        }),
      });

      const data = await res.json().catch(() => ({} as any));
      const answer = (data.answer || data.note || "Нет ответа") as string;

      const botMsg: ChatMsg = { id: uid(), role: "assistant", text: answer, ts: Date.now() };
      setMsgs((m) => [...m, botMsg]);

      // очищаем поле и сжимаем обратно
      setQ("");
      requestAnimationFrame(() => resizeTextarea());
    } catch {
      const botMsg: ChatMsg = {
        id: uid(),
        role: "assistant",
        text: "Ошибка запроса. Попробуйте ещё раз.",
        ts: Date.now(),
      };
      setMsgs((m) => [...m, botMsg]);
    } finally {
      setLoading(false);
    }
  }

  function clearChat() {
    setMsgs([]);
    setQ(product ? suggestedPrompt : "");
    requestAnimationFrame(() => resizeTextarea());
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Вопрос-ответ</h1>
          <p className="text-sm text-gray-600 mt-1">
            Спроси про продукт, состав, совместимость. Я отвечу на основе каталога и блога.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {productId ? (
            <Link
              href={`/shop/${encodeURIComponent(productId)}`}
              className="px-3 py-2 rounded-xl border bg-white/80 hover:bg-white transition text-sm"
            >
              К товару
            </Link>
          ) : null}

          <button
            type="button"
            className="px-3 py-2 rounded-xl border bg-white/80 hover:bg-white transition text-sm"
            onClick={clearChat}
            disabled={loading && msgs.length === 0}
          >
            Очистить
          </button>
        </div>
      </div>

      {product ? (
        <div className="rounded-2xl border p-4 bg-white/70 backdrop-blur">
          <div className="text-xs text-gray-500">Тема:</div>
          <div className="font-semibold">{product.name}</div>
          <div className="text-sm text-gray-600 mt-1">
            {(product.brand?.name || product.category) ?? product.category} •{" "}
            {Number(product.price).toLocaleString("ru-RU")} ₸
          </div>
        </div>
      ) : null}

      {/* История */}
      <div className="space-y-3">
        {msgs.length === 0 ? (
          <div className="text-sm text-gray-500">
            {product ? "Задайте вопрос по этому товару." : "Задайте вопрос."}
          </div>
        ) : (
          <div className="space-y-3">
            {msgs.map((m, idx) => {
              const isLastAssistant = m.role === "assistant" && idx === msgs.length - 1;

              return (
                <div
                  key={m.id}
                  ref={isLastAssistant ? lastAssistantRef : undefined}
                  tabIndex={isLastAssistant ? -1 : undefined}
                  className={
                    "rounded-2xl border p-4 whitespace-pre-line outline-none " +
                    (m.role === "user"
                      ? "bg-white/90"
                      : "bg-white/70 backdrop-blur") +
                    (isLastAssistant ? " ring-2 ring-black/10" : "")
                  }
                  aria-label={m.role === "user" ? "Ваш вопрос" : "Ответ ассистента"}
                >
                  <div className="text-xs text-gray-500 mb-1">
                    {m.role === "user" ? "Вы" : "ИИ"}
                  </div>
                  <div className="text-sm text-gray-800">{m.text}</div>
                </div>
              );
            })}
          </div>
        )}

        {loading ? <div className="text-sm text-gray-500">Думаю…</div> : null}
        <div ref={endRef} />
      </div>

      {/* Ввод */}
      <div className="card space-y-3">
        <textarea
          ref={taRef}
          className="w-full border rounded-xl px-3 py-2 text-sm resize-none overflow-hidden"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Например: можно ли это средство при чувствительной коже?"
          rows={2}
          onKeyDown={(e) => {
            // Enter = отправить, Shift+Enter = новая строка
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask();
            }
          }}
        />

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-gray-500">
            Enter — отправить, Shift+Enter — новая строка
          </div>

          <button
            className="btn"
            onClick={ask}
            disabled={loading || q.trim().length < 3}
            type="button"
          >
            {loading ? "Думаю..." : "Отправить"}
          </button>
        </div>
      </div>
    </div>
  );
}
