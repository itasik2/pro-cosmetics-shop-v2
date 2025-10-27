import ProductCard from "@/components/ProductCard";

async function getProducts() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_URL ?? ""}/api/products`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export default async function ShopPage() {
  const products = await getProducts();
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Каталог</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {products.map((p: any) => <ProductCard key={p.id} product={p} />)}
      </div>
    </div>
  );
}
