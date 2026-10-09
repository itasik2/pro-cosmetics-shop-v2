import { RepricingConsole } from "@/components/RepricingConsole";
import { hubFetch, organizationId, safeHub } from "@/lib/hub";
export const dynamic = "force-dynamic";
type Product = {id:string;sku:string;title:string;purchasePrice:number|null;price:number|null};
type Policy = {productId:string;channel:string;[key:string]:unknown};
type Data = {policies:Policy[]; observations:any[];decisions:any[]};
type Items = {items:Product[]};
export default async function RepricingPage() {
 const [a,b,overview]=await Promise.all([
  safeHub(hubFetch<Items>("/v1/catalog/products?organizationId="+encodeURIComponent(organizationId)+"&offset=0&limit=100")),
  safeHub(hubFetch<Items>("/v1/catalog/products?organizationId="+encodeURIComponent(organizationId)+"&offset=100&limit=100")),
  safeHub(hubFetch<Data>("/v1/repricing/overview?organizationId="+encodeURIComponent(organizationId))),
 ]);
 if(!a.ok||!b.ok||!overview.ok) return <div className="page"><h1>Репрайсер</h1><div className="error">{!a.ok?a.error:!b.ok?b.error:!overview.ok?overview.error:"Не удалось загрузить данные"}</div></div>;
 return <RepricingConsole products={[...a.data.items,...b.data.items]} policies={overview.data.policies as any}
   quotes={overview.data.observations as any} decisions={overview.data.decisions as any}/>;
}
