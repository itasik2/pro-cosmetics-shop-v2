import { digest, textField } from "./core-domain.ts";
import { once, outbox, lockProducts, type Sql, type Tx } from "./core-store.ts";
import { RequestError, type Principal } from "./request-context.ts";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status,
  headers: {"content-type":"application/json", "cache-control":"no-store"}});
type Member = {id:string; organizationId:string; sku:string; title:string; masterProductId:string|null;
  updatedAt:string|Date; snapshotVersion:string; [field:string]:unknown};
const common = ["title","brand","shortDescription","description","application","ingredients","categoryKey"] as const;
function ids(value:unknown) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 50) throw new RequestError("variant_group_size_invalid");
  const result=value.map(v=>textField(v,"product"));
  if (new Set(result).size !== result.length) throw new RequestError("variant_group_duplicate_product");
  return result.sort();
}
async function members(tx:Sql|Tx, org:string, productIds:string[]) {
  return await tx<Member[]>`SELECT p.*,p."updatedAt"::text AS "snapshotVersion",
    (SELECT count(*)::int FROM public."Product" v WHERE v."organizationId"=p."organizationId" AND v."masterProductId"=p."id") AS "childCount"
    FROM public."Product" p WHERE p."organizationId"=${org} AND p."id" IN ${tx(productIds)} ORDER BY p."id"`;
}
function state(rows:Member[]) {
  return rows.map(row=>({id:row.id, sku:row.sku, title:row.title, masterProductId:row.masterProductId,
    snapshotVersion:row.snapshotVersion}));
}
async function preview(tx:Sql|Tx, org:string, body:Record<string,unknown>) {
  const productIds=ids(body.productIds), masterProductId=textField(body.masterProductId,"master_product");
  if (!productIds.includes(masterProductId)) throw new RequestError("master_product_not_selected");
  const title=textField(body.title,"title",500), reason=textField(body.reason,"reason",1000);
  const rows=await members(tx,org,productIds);
  if(rows.length!==productIds.length)throw new RequestError("product_not_found",404);
  if(rows.some(r=>r.masterProductId || Number(r.childCount)>0))throw new RequestError("variant_already_grouped",409);
  const master=rows.find(r=>r.id===masterProductId)!;
  const conflicts=rows.filter(r=>r.id!==masterProductId).map(row=>({id:row.id,sku:row.sku,
    fields:common.filter(field=>field!=="title" && row[field] != null && row[field] !== "" &&
      JSON.stringify(row[field])!==JSON.stringify(master[field]))})).filter(r=>r.fields.length);
  const fingerprint=await digest({masterProductId,title,reason,rows:state(rows)});
  return {masterProductId,title,reason,fingerprint,conflicts,
    variants:rows.map(r=>({id:r.id,sku:r.sku,title:r.title,attributes:r.attributes,images:r.images,
      purchasePrice:r.purchasePrice,price:r.basePrice})),rows};
}
async function revision(tx:Tx, row:Member, actor:string, operation:string, groupingId:string) {
  await tx`INSERT INTO public."ProductRevision" ("id","productId","reason","snapshot","createdBy")
    VALUES (${crypto.randomUUID()},${row.id},${operation},${tx.json({...row,groupingId} as never)},${actor})`;
}

export async function handleVariants(req:Request, route:string, url:URL, sql:Sql, principal:Principal):Promise<Response|null> {
  if(!route.startsWith("/v1/catalog/variants"))return null;
  const org=principal.organizationId;
  const read=route.match(/^\/v1\/catalog\/variants\/([^/]+)$/);
  if(read && req.method==="GET") {
    const productId=textField(decodeURIComponent(read[1]),"product");
    const [selected]=await sql`SELECT "id","masterProductId" FROM public."Product" WHERE "organizationId"=${org} AND "id"=${productId}`;
    if(!selected)throw new RequestError("product_not_found",404);
    const masterId=selected.masterProductId||selected.id;
    const rows=await sql`SELECT p."id",p."sku",p."title",p."masterProductId",p."attributes",p."images",p."basePrice" AS "price",p."purchasePrice",p."updatedAt",
      COALESCE((SELECT sum(greatest(0,i."onHand"-i."reserved"-i."safetyStock"))::int FROM public."Inventory" i WHERE i."productId"=p."id"),0) AS "available"
      FROM public."CatalogProductRead" p WHERE p."organizationId"=${org} AND (p."id"=${masterId} OR p."masterProductId"=${masterId}) ORDER BY p."sku"`;
    const [last]=await sql`SELECT "id","status","createdAt","reason","actor" FROM public."ProductGrouping" WHERE "organizationId"=${org}
      AND "masterProductId"=${masterId} ORDER BY "createdAt" DESC,"id" DESC LIMIT 1`;
    return json({masterProductId:masterId,variants:rows,lastGrouping:last||null});
  }
  if(route==="/v1/catalog/variants/preview" && req.method==="POST") {
    const {rows:_,...result}=await preview(sql,org,await req.json());
    return json(result);
  }
  if(route==="/v1/catalog/variants/apply" && req.method==="POST") {
    const body=await req.json();
    if(body.confirmed!==true)throw new RequestError("variant_confirmation_required");
    return json(await once(sql,req,principal,route,body,async tx=>{
      await lockProducts(tx,org,ids(body.productIds));
      const result=await preview(tx,org,body);
      if(body.fingerprint!==result.fingerprint)throw new RequestError("variant_preview_stale",409);
      if (result.conflicts.length && body.conflictsAcknowledged!==true) throw new RequestError("variant_conflicts_confirmation_required");
      const groupingId=crypto.randomUUID();
      for(const row of result.rows)await revision(tx,row,principal.actor,"VARIANT_GROUP",groupingId);
      await tx`UPDATE public."Product" SET "masterProductId"=${result.masterProductId},"updatedAt"=clock_timestamp()
        WHERE "organizationId"=${org} AND "id" IN ${tx(result.rows.filter(r=>r.id!==result.masterProductId).map(r=>r.id))}`;
      await tx`UPDATE public."Product" SET "title"=${result.title},"updatedAt"=clock_timestamp()
        WHERE "organizationId"=${org} AND "id"=${result.masterProductId}`;
      const after=await members(tx,org,result.rows.map(r=>r.id));
      await tx`INSERT INTO public."ProductGrouping" ("id","organizationId","masterProductId","beforeState","afterState","reason","actor")
        VALUES (${groupingId},${org},${result.masterProductId},${tx.json(state(result.rows))},${tx.json(state(after))},${result.reason},${principal.actor})`;
      await outbox(tx,org,"catalog.variants_grouped",{groupingId,masterProductId:result.masterProductId,productIds:result.rows.map(r=>r.id),actor:principal.actor});
      return {status:"APPLIED",groupingId,masterProductId:result.masterProductId,variantCount:after.length};
    }));
  }
  const undo=route.match(/^\/v1\/catalog\/variants\/groupings\/([^/]+)\/undo$/);
  if(undo && req.method==="POST") {
    const body=await req.json(), groupingId=textField(decodeURIComponent(undo[1]),"grouping");
    if(body.confirmed!==true)throw new RequestError("variant_confirmation_required");
    return json(await once(sql,req,principal,route,body,async tx=>{
      const [operation]=await tx`SELECT * FROM public."ProductGrouping" WHERE "organizationId"=${org} AND "id"=${groupingId} FOR UPDATE`;
      if(!operation)throw new RequestError("grouping_not_found",404);
      if(operation.status!=="ACTIVE")throw new RequestError("grouping_already_undone",409);
      const before=operation.beforeState as ReturnType<typeof state>,expected=operation.afterState as ReturnType<typeof state>;
      await lockProducts(tx,org,before.map(r=>r.id));
      const current=await members(tx,org,before.map(r=>r.id));
      if(await digest(state(current))!==await digest(expected))throw new RequestError("variant_undo_conflict",409);
      for(const row of current)await revision(tx,row,principal.actor,"VARIANT_UNGROUP",groupingId);
      // Only grouping metadata and the title changed by this operation are
      // restored. Stock, supplier links, photos, prices and order references stay.
      for(const row of before)await tx`UPDATE public."Product" SET "masterProductId"=NULL,"title"=${row.title},"updatedAt"=clock_timestamp()
        WHERE "organizationId"=${org} AND "id"=${row.id}`;
      await tx`UPDATE public."ProductGrouping" SET "status"='UNDONE',"undoneAt"=clock_timestamp() WHERE "organizationId"=${org} AND "id"=${groupingId}`;
      await outbox(tx,org,"catalog.variants_ungrouped",{groupingId,productIds:before.map(r=>r.id),actor:principal.actor});
      return {status:"UNDONE",groupingId};
    }));
  }
  return json({error:"not_found"},404);
}
