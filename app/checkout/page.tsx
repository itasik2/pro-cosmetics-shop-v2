"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function CheckoutPage() {
  const params = useSearchParams();
  const id = params.get("id");
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    async function run() {
      if (!id) return;
      const res = await fetch(`/api/products/${id}`);
      if (res.ok) setProduct(await res.json());
    }
    run();
  }, [id]);
  async function pay() {
    if (!product) return;
    setLoading(true);
    const res = await fetch("/api/checkout", { method: "POST", body: JSON.stringify({ items: [{ name: product.name, price: product.price, quantity: 1 }] }) });
    const data = await res.json();
    setLoading(false);
    if (data.url) window.location.href = data.url;
    else alert(data.note || "Stripe не настроен.");
  }
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Оформление</h2>
      {!product ? <div>Добавьте товар из каталога.</div> : (
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">{product.name}</div>
              <div className="text-sm text-gray-500">{product.brand}</div>
            </div>
            <div className="font-semibold">{(product.price/100).toFixed(2)} ₸</div>
          </div>
          <button className="btn mt-4" onClick={pay} disabled={loading}>
            {loading ? "Перенаправление..." : "Оплатить"}
          </button>
        </div>
      )}
    </div>
  );
}
