// app/checkout/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;
// если вдруг был ISR/SSG выше в дереве:
export const fetchCache = "default-no-store";

"use client";

import { useState } from "react";

export default function CheckoutPage() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleCheckout() {
    try {
      setLoading(true);
      setErr(null);

      // TODO: подставь реальные позиции корзины
      const items = [{ name: "Sample Product", price: 1999.0, quantity: 1 }];

      const res = await fetch("/api/checkout/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });

      const data = await res.json();
      if (!res.ok || !data?.url) {
        setErr(data?.error || "failed_to_create_session");
        setLoading(false);
        return;
      }

      window.location.href = data.url;
    } catch {
      setErr("unexpected_error");
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto py-10 space-y-4">
      <h1 className="text-2xl font-bold">Оформление заказа</h1>
      {err && <p className="text-red-600">Ошибка: {err}</p>}
      <button
        className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
        disabled={loading}
        onClick={handleCheckout}
      >
        {loading ? "Переход в оплату…" : "Оплатить"}
      </button>
    </div>
  );
}
