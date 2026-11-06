import {ChannelsConsole} from "@/components/ChannelsConsole";
import {coreMessage,type CoreProduct,type CoreWarehouse,type CoreConnection} from "@/lib/core-client";
import {hubFetch,organizationId,warehouseId,safeHub} from "@/lib/hub";
import {isLocalReadOnly} from "@/lib/local-mode";
export default async function ChannelsPage(){
  const org=encodeURIComponent(organizationId);
  const [products,warehouses,connections]=await Promise.all([
    safeHub(hubFetch<CoreProduct[]>("/v1/catalog/product-options?limit=50&organizationId="+org)),
    safeHub(hubFetch<CoreWarehouse[]>("/v1/inventory/warehouses?organizationId="+org)),
    safeHub(hubFetch<CoreConnection[]>("/v1/channels?organizationId="+org)),
  ]);
  const error=!products.ok?products.error:!warehouses.ok?warehouses.error:!connections.ok?connections.error:null;
  return <div className="page"><div className="page-head"><div><h1>Каналы продаж</h1><p>Собственные магазины, предложения, сопоставления складов и выгрузки.</p></div></div>
    {error?<p role="alert" className="error">{coreMessage(new Error(error))}</p>:<ChannelsConsole products={products.data||[]} warehouses={warehouses.data||[]} connections={connections.data||[]} defaultWarehouseId={warehouseId} canWrite={!isLocalReadOnly()} />}
  </div>;
}
