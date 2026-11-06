import Link from "next/link";
import { InventoryConsole, type Movement } from "@/components/InventoryConsole";
import { coreMessage,type CoreProduct,type CoreWarehouse } from "@/lib/core-client";
import {hubFetch,organizationId,warehouseId,safeHub} from "@/lib/hub";
import {isLocalReadOnly} from "@/lib/local-mode";
export default async function InventoryPage({searchParams}:{searchParams:Promise<{cursor?:string}>}){
  const {cursor=""}=await searchParams,org=encodeURIComponent(organizationId);
  const [products,warehouses,movements]=await Promise.all([
    safeHub(hubFetch<CoreProduct[]>("/v1/catalog/product-options?limit=50&organizationId="+org)),
    safeHub(hubFetch<CoreWarehouse[]>("/v1/inventory/warehouses?organizationId="+org)),
    safeHub(hubFetch<{items:Movement[];nextCursor:string|null}>("/v1/inventory/movements?organizationId="+org+"&cursor="+encodeURIComponent(cursor))),
  ]);
  const error=!products.ok?products.error:!warehouses.ok?warehouses.error:!movements.ok?movements.error:null;
  return <div className="page"><div className="page-head"><div><h1>Склад</h1><p>Приход, списание, перемещение и история резервов.</p></div></div>
    {error?<p role="alert" className="error">{coreMessage(new Error(error))}</p>:<InventoryConsole products={products.data||[]} warehouses={warehouses.data||[]} movements={movements.data?.items||[]} defaultWarehouseId={warehouseId} canWrite={!isLocalReadOnly()} />}
    {movements.ok&&movements.data.nextCursor&&<Link className="button core-section" href={"/inventory?cursor="+encodeURIComponent(movements.data.nextCursor)} prefetch={false}>Следующие движения</Link>}
  </div>;
}
