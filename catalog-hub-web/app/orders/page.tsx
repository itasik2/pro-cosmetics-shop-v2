import Link from "next/link";
import {OrdersConsole} from "@/components/OrdersConsole";
import {coreMessage,type CoreOrder,type CoreProduct,type CoreWarehouse,type CoreConnection} from "@/lib/core-client";
import {hubFetch,organizationId,warehouseId,safeHub} from "@/lib/hub";
export default async function OrdersPage({searchParams}:{searchParams:Promise<{cursor?:string}>}){
  const {cursor=""}=await searchParams,org=encodeURIComponent(organizationId);
  const [products,warehouses,connections,orders]=await Promise.all([
    safeHub(hubFetch<CoreProduct[]>("/v1/catalog/product-options?limit=50&organizationId="+org)),
    safeHub(hubFetch<CoreWarehouse[]>("/v1/inventory/warehouses?organizationId="+org)),
    safeHub(hubFetch<CoreConnection[]>("/v1/channels?organizationId="+org)),
    safeHub(hubFetch<{items:CoreOrder[];nextCursor:string|null}>("/v1/orders?organizationId="+org+"&cursor="+encodeURIComponent(cursor))),
  ]);
  const error=!products.ok?products.error:!warehouses.ok?warehouses.error:!connections.ok?connections.error:!orders.ok?orders.error:null;
  return <div className="page"><div className="page-head"><div><h1>Заказы</h1><p>Входящие заказы, резервы, отгрузки и возвраты.</p></div></div>
    {error?<p role="alert" className="error">{coreMessage(new Error(error))}</p>:<OrdersConsole products={products.data||[]} warehouses={warehouses.data||[]} connections={connections.data||[]} orders={orders.data?.items||[]} defaultWarehouseId={warehouseId} />}
    {orders.ok&&orders.data.nextCursor&&<Link className="button core-section" href={"/orders?cursor="+encodeURIComponent(orders.data.nextCursor)} prefetch={false}>Следующие заказы</Link>}
  </div>;
}
