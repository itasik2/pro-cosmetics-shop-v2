import { hubFetch, organizationId, safeHub, type HubProduct } from "@/lib/hub";
import { ProductEditor } from "@/components/ProductEditor";
import { StockAdjustment } from "@/components/StockAdjustment";
import { isLocalReadOnly } from "@/lib/local-mode";
import Link from "next/link";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = "?organizationId=" + encodeURIComponent(organizationId);
  const [result, warehouses, categories] = await Promise.all([
    safeHub(hubFetch<HubProduct>("/v1/catalog/products/" + encodeURIComponent(id) + query)),
    safeHub(hubFetch<Array<{id:string;code:string;name:string;isActive:boolean}>>("/v1/inventory/warehouses" + query)),
    safeHub(hubFetch<{categories:Array<{key:string;name:string;isActive:boolean;productCount:number}>;uncategorized:number}>("/v1/categories" + query)),
  ]);

  if (!result.ok) return <div className="page"><div className="error">{result.error}</div></div>;
  const product = result.data;

  return <div className="page">
    <div className="page-head">
      <div><span className="eyebrow">{product.sku}</span><h1>{product.title}</h1>
        <p>{product.brand || "Без бренда"} · {product.categoryKey || "Без категории"}</p></div>
      <Link className="button" href="/catalog">← Каталог</Link>
    </div>
    <ProductEditor product={product} categories={categories.ok ? categories.data.categories : []}
      canWrite={!isLocalReadOnly()}
      searchEnabled={Boolean(process.env.PRO_COSMETICS_SHARED_ENRICHMENT_URL &&
        (process.env.CATALOG_HUB_SHARED_ENRICHMENT_TOKEN?.length || 0) >= 32)} />
    {!categories.ok && <p className="error" role="alert">Справочник категорий недоступен: {categories.error}</p>}
    <div style={{marginTop:14}}>
      {warehouses.ok ? <StockAdjustment product={product} warehouses={warehouses.data} />
        : <section className="panel"><h2>Остатки</h2><p>На складе: {product.totals.stock} · Доступно: {product.totals.available}</p>
          <p className="error" role="alert">Склады временно недоступны: {warehouses.error}</p></section>}
    </div>
  </div>;
}
