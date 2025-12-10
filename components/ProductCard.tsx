import Link from "next/link";

export default function ProductCard({ product }: { product: any }) {
  return (
    <div className="card">
      <div className="aspect-square w-full bg-gray-100 rounded-xl mb-3 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.image}
          alt={product.name}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="text-sm text-gray-500">{product.brand}</div>
      <h3 className="font-semibold">{product.name}</h3>
      <div className="flex items-center justify-between mt-2">
        <div className="font-semibold">
          {Number(product.price).toLocaleString("ru-RU")} ₸
        </div>
        <Link href={`/shop/${product.id}`} className="btn text-xs">
          Подробнее
        </Link>
      </div>
    </div>
  );
}
