// app/ask/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type ProductCtx = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  brand?: { name?: string } | null;
};

async function fetchProduct(productId: string): Promise<ProductCtx | null> {
  // Вариант без доп. API: тянем минимум из /api/products (если у вас он есть только списком — тогда лучше сделать отдельный endpoint).
  // Чтобы не ломать архитектуру, делаем мягкую попытку через /api/products/{id}, а если такого нет — просто работаем без контекста.
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

export default function AskPage() {
  const sp = useSearchParams();
  const productId = (sp.get("productId") || "").trim();

  const [product, setProduct] = useState<ProductCtx | null>(null);

  const [q, setQ] = useState("");
  const [a, setA] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Подтянуть контекст товара при заходе с карточки
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
${brand}${product.price?.toLocaleString?.("ru-RU") ?? product.price} ₸
Категория: ${product.category}

Мой вопрос: `;
  }, [product]);

  // Префилл поля вопроса (только если оно пустое)
  useEffect(() => {
    if (product && !q.trim()) {
      setQ(suggestedPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  async function ask() {
    const query = q.trim();
    if (query.length < 3) return;

    setLoading(true);
    setA(null);

    // Контекст, который передаем на бэкенд (если он захочет использовать)
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

    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, context }),
    });

    const data = await res.json().catch(() => ({} as any));
    setLoading(false);
    setA(data.answer || data.note || "Нет ответа");
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Вопрос-ответ</h1>
      <p className="text-sm text-gray-600">
        Спроси про продукт, состав, совместимость. Я отвечу на основе каталога и
        блога.
      </p>

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

      <div className="card space-y-3">
        <input
          className="w-full border rounded-xl px-3 py-2"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Например: можно ли это масло при чувствительной коже?"
        />
        <button className="btn" onClick={ask} disabled={loading || q.trim().length < 3}>
          {loading ? "Думаю..." : "Спросить"}
        </button>
      </div>

      {a && <div className="card whitespace-pre-line">{a}</div>}
    </div>
  );
}
