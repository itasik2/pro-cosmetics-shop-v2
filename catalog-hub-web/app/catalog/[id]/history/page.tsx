import Link from "next/link";
import { ProductHistory } from "@/components/ProductHistory";
import { hubFetch, safeHub, type HubProduct } from "@/lib/hub";
import { isLocalReadOnly } from "@/lib/local-mode";

export default async function ProductHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const path = "/catalog/" + encodeURIComponent(id);
  const product = await safeHub(hubFetch<HubProduct>("/v1/catalog/products/" + encodeURIComponent(id)));
  return <div className="page">
    <div className="page-head">
      <div><h1>История карточки</h1>{product.ok && <p>{product.data.title} · {product.data.sku}</p>}</div>
      <Link className="button" href={path}>К карточке</Link>
    </div>
    {product.ok ? <ProductHistory productId={id} canWrite={!isLocalReadOnly()} /> : <p className="error">{product.error}</p>}
  </div>;
}
