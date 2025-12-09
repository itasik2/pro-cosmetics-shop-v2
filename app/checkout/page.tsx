// app/checkout/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "default-no-store";

"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type Product = { id: string; name: string; brand?: string; price: number /* МИНОРНЫЕ (тиыны) */ };

export default function CheckoutPage() {
  const params = useSearchParams();
  const id = params.get("id");
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!id) return;
      try {
        const res = await fetch(`/api/products/${id}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const p = (await res.json()) as Product;
        if (mounted) setProduct(p);
      } catch {
        if (mounted) setErr("Не удалось загрузить товар");
      }
    })();
    return () => { mounted = false; };
  }, [id]);

  async function pay() {
    if (!product) return;
    setLoading(true);
    setErr(null);
    try {
      // price из товара в тиынах → переводим в тенге (major)
      const items = [{ name: product.name, price: product.price / 100, quantity: 1 }];

      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok || !data?.url) throw new Error(data?.error || "failed_to_create_session");
      window.location.href = data.url;
    } catch (e: any) {
      setErr(e?.message || "Ошибка оплаты");
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto py-8 space-y-6">
      <h2 className="text-2xl font-bold">Оформление</h2>
      {!product && !err && <div>Добавьте товар из каталога.</div>}
      {err && <div className="text-red-600">Ошибка: {err}</div>}
      {product && (
        <div className="rounded-2xl border p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">{product.name}</div>
              {product.brand && <div className="text-sm text-gray-500">{product.brand}</div>}
            </div>
            <div className="font-semibold">{(product.price / 100).toFixed(2)} ₸</div>
          </div>
          <button className="mt-4 px-4 py-2 rounded bg-black text-white disabled:opacity-50" onClick={pay} disabled={loading}>
            {loading ? "Перенаправление…" : "Оплатить"}
          </button>
        </div>
      )}
    </div>
  );
}
