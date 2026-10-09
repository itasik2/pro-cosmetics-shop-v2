import { RepricingConsole } from "@/components/RepricingConsole";
import { hubFetch, organizationId, safeHub } from "@/lib/hub";
export const dynamic = "force-dynamic";

type Product = { id:string;sku:string;title:string;purchasePrice:number|null;price:number|null };
type Policy = { productId:string;channel:string;[key:string]:unknown };
type Data = { policies:Policy[];observations:any[];decisions:any[] };

export default async function RepricingPage() {
  // Lightweight product choices: no inventory enrichment or 100+ extra SQL calls.
  const [products, overview] = await Promise.all([
    safeHub(hubFetch<Product[]>("/v1/catalog/product-options?organizationId=" + encodeURIComponent(organizationId))),
    safeHub(hubFetch<Data>("/v1/repricing/overview?organizationId=" + encodeURIComponent(organizationId))),
  ]);
  if (!products.ok || !overview.ok) return <div className="page">
    <h1>Репрайсер</h1>
    <div className="error">{!products.ok ? products.error : !overview.ok ? overview.error : "Не удалось загрузить данные"}</div>
  </div>;
  return <RepricingConsole products={products.data} policies={overview.data.policies as any}
    quotes={overview.data.observations as any} decisions={overview.data.decisions as any}/>;
}
