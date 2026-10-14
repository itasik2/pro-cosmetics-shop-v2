import { hubFetch, organizationId, safeHub, type HubProduct } from "@/lib/hub";
import { ProductEditor } from "@/components/ProductEditor";
import { CardEnrichment, type CardJob, type CardProposal } from "@/components/CardEnrichment";
import { StockAdjustment } from "@/components/StockAdjustment";
import { isLocalReadOnly } from "@/lib/local-mode";
import Link from "next/link";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = "?organizationId=" + encodeURIComponent(organizationId);
  const filter = query + "&productId=" + encodeURIComponent(id);
  const [result, warehouses, categories, jobs, proposals] = await Promise.all([
    safeHub(hubFetch<HubProduct>("/v1/catalog/products/" + encodeURIComponent(id) + query)),
    safeHub(hubFetch<Array<{id:string;code:string;name:string;isActive:boolean}>>("/v1/inventory/warehouses" + query)),
    safeHub(hubFetch<{categories:Array<{key:string;name:string;isActive:boolean;productCount:number}>;uncategorized:number}>("/v1/categories" + query)),
    safeHub(hubFetch<CardJob[]>("/v1/ai/enrichment/jobs" + filter + "&limit=30")),
    safeHub(hubFetch<CardProposal[]>("/v1/ai/enrichment/proposals" + filter + "&limit=30")),
  ]);

  if (!result.ok) return <div className="page"><div className="error">{result.error}</div></div>;
  const product = result.data;

  return <div className="page">
    <div className="page-head">
      <div><span className="eyebrow">{product.sku}</span><h1>{product.title}</h1>
        <p>{product.brand || "Без бренда"} · {product.categoryKey || "Без категории"}</p></div>
      <Link className="button" href="/catalog">← Каталог</Link>
    </div>
    <ProductEditor product={product} categories={categories.ok ? categories.data.categories : []} />
    {!categories.ok && <p className="error" role="alert">Справочник категорий недоступен: {categories.error}</p>}
    {(!jobs.ok || !proposals.ok) && <p className="error" role="alert">
      ИИ-предложения временно недоступны: {!jobs.ok ? jobs.error : !proposals.ok ? proposals.error : ""}
    </p>}
    <div style={{marginTop:14}}>
      <CardEnrichment product={product} canWrite={!isLocalReadOnly()}
        jobs={jobs.ok ? jobs.data : []} proposals={proposals.ok ? proposals.data : []} />
    </div>
    <div style={{marginTop:14}}>
      {warehouses.ok && <StockAdjustment product={product} warehouses={warehouses.data} />}
    </div>
  </div>;
}
