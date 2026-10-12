import type postgres from "npm:postgres@3.4.7";
type Sql = ReturnType<typeof postgres>;
function json(data:unknown,status=200) {
  return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
}
function fail(message:string,status=400):never { throw Object.assign(new Error(message),{status}); }
function string(v:unknown,key:string,max=128):string {
  if(typeof v!=="string"||!v.trim()||v.length>max) fail("invalid_"+key);
  return (v as string).trim();
}
async function payload(req:Request):Promise<Record<string,unknown>> {
  if(Number(req.headers.get("content-length")||0)>10000) fail("payload_too_large",413);
  const v:unknown=await req.json().catch(()=>null);
  if(!v||typeof v!=="object"||Array.isArray(v)) fail("invalid_body");
  return v as Record<string,unknown>;
}
export async function handleInventory(req:Request,route:string,url:URL,sql:Sql):Promise<Response|null> {
  if(!route.startsWith("/v1/inventory/")) return null;
  try {
    if(route==="/v1/inventory/warehouses"&&req.method==="GET") {
      const organizationId=string(url.searchParams.get("organizationId"),"organization");
      const rows=await sql`SELECT "id","code","name","isActive" FROM public."Warehouse"
        WHERE "organizationId"=${organizationId} AND "isActive"=true ORDER BY "code"`;
      return json(rows);
    }
    if(route==="/v1/inventory/adjustments"&&req.method==="GET") {
      const organizationId=string(url.searchParams.get("organizationId"),"organization");
      const productId=string(url.searchParams.get("productId"),"product");
      const rows=await sql`SELECT a."id",a."delta",a."beforeOnHand",a."afterOnHand",a."reason",
        a."createdAt",w."code" AS "warehouseCode",w."name" AS "warehouseName"
        FROM public."InventoryAdjustment" a
        JOIN public."Product" p ON p."id"=a."productId" AND p."organizationId"=a."organizationId"
        JOIN public."Warehouse" w ON w."id"=a."warehouseId"
        WHERE a."organizationId"=${organizationId} AND a."productId"=${productId}
        ORDER BY a."createdAt" DESC LIMIT 30`;
      return json(rows);
    }
    if(route==="/v1/inventory/adjustments"&&req.method==="POST") {
      const data=await payload(req);
      const organizationId=string(data.organizationId,"organization");
      const productId=string(data.productId,"product");
      const warehouseId=string(data.warehouseId,"warehouse");
      const requestId=string(data.requestId,"request");
      if(!/^[a-f0-9-]{36}$/i.test(requestId)) fail("request_id_invalid");
      const reason=string(data.reason,"reason",500);
      if(reason.length<5) fail("reason_too_short");
      const delta=data.delta,expectedOnHand=data.expectedOnHand;
      if(typeof delta!=="number"||!Number.isSafeInteger(delta)||delta===0||Math.abs(delta)>100000) fail("invalid_delta");
      if(typeof expectedOnHand!=="number"||!Number.isSafeInteger(expectedOnHand)||expectedOnHand<0) fail("invalid_expected_stock");
      const result=await sql.begin(async(tx)=>{
        const products=await tx`SELECT "id" FROM public."Product"
          WHERE "id"=${productId} AND "organizationId"=${organizationId} FOR UPDATE`;
        if(!products.length) fail("product_not_found",404);
        const previousAdjustment=await tx`SELECT * FROM public."InventoryAdjustment"
          WHERE "organizationId"=${organizationId} AND "requestId"=${requestId} LIMIT 1`;
        if(previousAdjustment.length){
          const old=previousAdjustment[0];
          if(old.productId!==productId||old.warehouseId!==warehouseId||
            old.delta!==delta||old.beforeOnHand!==expectedOnHand) fail("request_id_reused",409);
          return {id:old.id,afterOnHand:old.afterOnHand,status:"ALREADY_APPLIED"};
        }
        const warehouse=await tx`SELECT "id" FROM public."Warehouse" WHERE "id"=${warehouseId}
          AND "organizationId"=${organizationId} AND "isActive"=true LIMIT 1`;
        if(!warehouse.length) fail("warehouse_not_found",404);
        const inventory=await tx`SELECT * FROM public."Inventory" WHERE "productId"=${productId}
          AND "warehouseId"=${warehouseId} FOR UPDATE`;
        const before=inventory.length?Number(inventory[0].onHand):0;
        const reserved=inventory.length?Number(inventory[0].reserved):0;
        if(before!==expectedOnHand) fail("stock_changed_refresh",409);
        const after=before+delta;
        if(!Number.isSafeInteger(after)||after<0||after<reserved) fail("stock_below_reserved",409);
        if(inventory.length){
          await tx`UPDATE public."Inventory" SET "onHand"=${after},"updatedAt"=now()
            WHERE "id"=${inventory[0].id}`;
        } else {
          await tx`INSERT INTO public."Inventory" ("id","productId","warehouseId",
            "onHand","reserved","safetyStock","updatedAt")
            VALUES (${crypto.randomUUID()},${productId},${warehouseId},${after},0,0,now())`;
        }
        const saved=await tx`INSERT INTO public."InventoryAdjustment"
          ("requestId","organizationId","productId","warehouseId","delta","beforeOnHand",
          "afterOnHand","reservedAtTime","reason","actor")
          VALUES (${requestId},${organizationId},${productId},${warehouseId},
          ${delta},${before},${after},${reserved},${reason},'catalog-hub-ui')
          RETURNING "id","createdAt"`;
        return {id:saved[0].id,createdAt:saved[0].createdAt,afterOnHand:after,status:"APPLIED"};
      });
      return json(result,201);
    }
    return json({error:"not_found"},404);
  }catch(error){
    const e=error as Error & {status?:number};
    if(e.status) return json({error:e.message},e.status);
    console.error("inventory_adjustment_error",e);
    return json({error:"inventory_error"},500);
  }
}
