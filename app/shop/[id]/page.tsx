import Link from "next/link";

async function getProduct(id: string) {
  const base = process.env.NEXT_PUBLIC_URL ?? "";
  const res = await fetch(`${base}/api/products/${id}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

export default async function ProductPage({ params }: { params: { id: string } }) {
  const product = await getProduct(params.id);
  if (!product) return <div>Товар не найден</div>;
  return (
    <div className="grid md:grid-cols-2 gap-8">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={product.image} alt={product.name} className="w-full rounded-3xl border" />
      <div className="space-y-4">
        <div className="text-sm text-gray-500">{product.brand}</div>
        <h1 className="text-3xl font-bold">{product.name}</h1>
        <div className="text-gray-600">{product.description}</div>
        <div className="text-2xl font-semibold">{item.price.toLocaleString("ru-RU")} ₸</div>
        <form action="/checkout" method="GET">
          <input type="hidden" name="id" value={product.id} />
          <button className="btn">В корзину</button>
        </form>
      </div>
    </div>
  );
}
