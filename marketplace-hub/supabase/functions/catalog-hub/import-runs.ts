import {digest, integer, operationKey, textField} from "./core-domain.ts";
import {once, outbox, type Sql, type Tx} from "./core-store.ts";
import {RequestError, type Principal} from "./request-context.ts";
import {checkImportCapacity,importLimits,importQueueStatus,lockImportQuota} from "./import-limits.ts";
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
export type ImportAction={rowNumber:number;sku:string;action:"CREATE"|"STAGE"|"AUTO_INCREASE";
  payload:Record<string,unknown>;expectedUpdatedAt:string|null};
type Executor=(tx:Tx,action:ImportAction,principal:Principal)=>Promise<unknown>;
function action(value:unknown):ImportAction {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new RequestError("invalid_import_action");
  const row=value as Record<string,unknown>;
  const rowNumber=integer(row.rowNumber,"row_number",1,10001),sku=textField(row.sku,"sku",100);
  if(!["CREATE","STAGE","AUTO_INCREASE"].includes(String(row.action)))throw new RequestError("invalid_import_action");
  if(!row.payload||typeof row.payload!=="object"||Array.isArray(row.payload)||new TextEncoder().encode(JSON.stringify(row.payload)).length>importLimits.rowPayloadBytes)throw new RequestError("invalid_import_payload");
  const expected=row.expectedUpdatedAt;
  if(row.action!=="CREATE"&&(typeof expected!=="string"||!Number.isFinite(Date.parse(expected))))throw new RequestError("invalid_product_version");
  return {rowNumber,sku,action:row.action as ImportAction["action"],payload:row.payload as Record<string,unknown>,expectedUpdatedAt:typeof expected==="string"?expected:null};
}
const summary=`"id","fileName","fileSha256","manifestHash","supplierId","sourceDate","profile","expectedRows","uploadedRows","processedRows","failedRows","payloadBytes","state","version","actor","createdAt","updatedAt",
 (SELECT count(*)::int FROM public."CatalogImportRow" r WHERE r."organizationId"="CatalogImportRun"."organizationId" AND r."runId"="CatalogImportRun"."id" AND r."state"='STAGED') AS "stagedRows",
 (SELECT count(*)::int FROM public."CatalogImportRow" r WHERE r."organizationId"="CatalogImportRun"."organizationId" AND r."runId"="CatalogImportRun"."id" AND r."state"='APPLIED') AS "appliedRows"`;

export async function handleImportRuns(req:Request,route:string,url:URL,sql:Sql,principal:Principal,execute:Executor):Promise<Response|null>{
  if(!route.startsWith("/v1/imports"))return null;
  const org=principal.organizationId;
  if(route==="/v1/imports/status"&&req.method==="GET")return json(await importQueueStatus(sql,org));
  if(route==="/v1/imports"&&req.method==="GET"){
    const active=url.searchParams.get("active")==="true";
    return json(await sql`SELECT ${sql.unsafe(summary)} FROM public."CatalogImportRun" WHERE "organizationId"=${org}
      AND (NOT ${active} OR "state" IN ('QUEUED','RUNNING')) ORDER BY ${sql.unsafe(active?'"createdAt","id"':'"createdAt" DESC,"id" DESC')} LIMIT 50`);
  }
  if(route==="/v1/imports"&&req.method==="POST"){
    const body=await req.json(),fileName=textField(body.fileName,"file_name",200),expectedRows=integer(body.expectedRows,"row_count",1,importLimits.runRows);
    if(!/^[a-f0-9]{64}$/.test(body.fileSha256)||!/^[a-f0-9]{64}$/.test(body.manifestHash))throw new RequestError("invalid_import_fingerprint");
    if(body.sourceDate!=null&&(!/^\d{4}-\d{2}-\d{2}$/.test(body.sourceDate)||!Number.isFinite(Date.parse(body.sourceDate))))throw new RequestError("invalid_source_date");
    if(!body.profile||typeof body.profile!=="object"||Array.isArray(body.profile)||JSON.stringify(body.profile).length>20000)throw new RequestError("invalid_import_profile");
    const supplierId=body.supplierId?textField(body.supplierId,"supplier"):null;
    return json(await once(sql,req,principal,route,body,async tx=>{
      await lockImportQuota(tx,org);
      await checkImportCapacity(tx,org,{runs:1,rows:expectedRows});
      if(supplierId){const [supplier]=await tx`SELECT "id" FROM public."Supplier" WHERE "id"=${supplierId} AND "organizationId"=${org} AND "isActive"=true`;
        if(!supplier)throw new RequestError("supplier_not_found",404);}
      const [run]=await tx`INSERT INTO public."CatalogImportRun" ("id","organizationId","fileName","fileSha256","manifestHash","supplierId","sourceDate","profile","expectedRows","actor","updatedAt")
        VALUES (${crypto.randomUUID()},${org},${fileName},${body.fileSha256},${body.manifestHash},${supplierId},${body.sourceDate||null},${tx.json(body.profile)},${expectedRows},${principal.actor},now()) RETURNING *`;
      return run;
    }),201);
  }
  const match=route.match(/^\/v1\/imports\/([^/]+)(?:\/(rows|seal|process|cancel|retry))?$/);
  if(!match)return json({error:"not_found"},404);
  const id=textField(decodeURIComponent(match[1]),"import"),part=match[2];
  const [run]=await sql`SELECT ${sql.unsafe(summary)} FROM public."CatalogImportRun" WHERE "id"=${id} AND "organizationId"=${org}`;
  if(!run)throw new RequestError("import_not_found",404);
  if(!part&&req.method==="GET")return json(run);
  if(part==="rows"&&req.method==="GET"){
    const after=Math.max(0,Number(url.searchParams.get("after"))||0),limit=Math.max(1,Math.min(100,Number(url.searchParams.get("limit"))||100));
    const rows=await sql`SELECT "rowNumber","sku","action","state","attempts","errorCode","result" FROM public."CatalogImportRow"
      WHERE "organizationId"=${org} AND "runId"=${id} AND "rowNumber">${after} ORDER BY "rowNumber" LIMIT ${limit+1}`;
    return json({items:rows.slice(0,limit),nextCursor:rows.length>limit?rows[limit-1].rowNumber:null});
  }
  if(part==="rows"&&req.method==="POST"){
    const body=await req.json();
    if(!Array.isArray(body.rows)||!body.rows.length||body.rows.length>importLimits.chunkRows)throw new RequestError("import_chunk_limit");
    const rows=body.rows.map(action);
    if(new Set(rows.map((r:ImportAction)=>r.rowNumber)).size!==rows.length)throw new RequestError("duplicate_import_row");
    return json(await once(sql,req,principal,route,body,async tx=>{
      await lockImportQuota(tx,org);
      const [current]=await tx`SELECT "state","expectedRows","uploadedRows","payloadBytes" FROM public."CatalogImportRun" WHERE "id"=${id} AND "organizationId"=${org} FOR UPDATE`;
      if(current.state!=="UPLOADING")throw new RequestError("import_already_sealed",409);
      if(current.uploadedRows+rows.length>current.expectedRows)throw new RequestError("import_row_count_exceeded",409);
      let bytes=0;
      for(const row of rows){
        if(row.action!=="STAGE" && (row.payload.supplierId??null)!==(run.supplierId??null)) throw new RequestError("import_supplier_mismatch");
        if(row.action==="AUTO_INCREASE" && (row.payload.fileSha256!==run.fileSha256||row.payload.sourceDate!==run.sourceDate)) throw new RequestError("invalid_import_fingerprint");
        const payloadHash=await digest(row);
        const [saved]=await tx`INSERT INTO public."CatalogImportRow" ("id","organizationId","runId","rowNumber","sku","action","payload","payloadHash","expectedUpdatedAt","updatedAt")
          VALUES (${crypto.randomUUID()},${org},${id},${row.rowNumber},${row.sku},${row.action},${tx.json(row.payload)},${payloadHash},${row.expectedUpdatedAt},now())
          RETURNING octet_length("payload"::text)::int AS bytes`;
        bytes+=saved.bytes;
      }
      if(current.payloadBytes+bytes>importLimits.runPayloadBytes)throw new RequestError("import_run_payload_limit",413);
      await checkImportCapacity(tx,org,{bytes});
      const [updated]=await tx`UPDATE public."CatalogImportRun" SET "uploadedRows"="uploadedRows"+${rows.length},"payloadBytes"="payloadBytes"+${bytes},"version"="version"+1,"updatedAt"=now()
        WHERE "id"=${id} AND "organizationId"=${org} RETURNING "id","state","uploadedRows","expectedRows","version","payloadBytes"`;
      return updated;
    }));
  }
  if(part==="seal"&&req.method==="POST"){
    const body=await req.json();if(body.confirmed!==true)throw new RequestError("confirmation_required");
    return json(await once(sql,req,principal,route,body,async tx=>{
      const [current]=await tx`SELECT * FROM public."CatalogImportRun" WHERE "id"=${id} AND "organizationId"=${org} FOR UPDATE`;
      if(current.state!=="UPLOADING")throw new RequestError("import_already_sealed",409);
      const rows=await tx`SELECT "rowNumber","payloadHash" FROM public."CatalogImportRow" WHERE "organizationId"=${org} AND "runId"=${id} ORDER BY "rowNumber"`;
      if(rows.length!==current.expectedRows||await digest(rows.map(r=>({rowNumber:r.rowNumber,payloadHash:r.payloadHash})))!==current.manifestHash)
        throw new RequestError("import_incomplete_manifest",409);
      const [saved]=await tx`UPDATE public."CatalogImportRun" SET "state"='QUEUED',"version"="version"+1,"updatedAt"=now() WHERE "id"=${id} AND "organizationId"=${org} RETURNING *`;
      await outbox(tx,org,"import.queued",{id,rows:rows.length,actor:principal.actor});return saved;
    }));
  }
  if(part==="process"&&req.method==="POST"){
    operationKey(req);const body=await req.json(),limit=integer(body.limit??20,"batch_limit",1,importLimits.batchRows);
    let processed=0;const deadline=Date.now()+importLimits.batchTimeMs;
    for(;processed<limit&&Date.now()<deadline;processed++){
      const didWork=await sql.begin(async tx=>{
        const [current]=await tx`SELECT "state","expectedRows","processedRows","failedRows" FROM public."CatalogImportRun" WHERE "id"=${id} AND "organizationId"=${org} FOR UPDATE SKIP LOCKED`;
        if(!current||!['QUEUED','RUNNING'].includes(current.state))return false;
        const [row]=await tx`SELECT * FROM public."CatalogImportRow" WHERE "organizationId"=${org} AND "runId"=${id} AND "state"='PENDING' ORDER BY "rowNumber" LIMIT 1 FOR UPDATE`;
        if(!row)return false;
        let result:unknown=null,errorCode:string|null=null;
        try{
          result=await tx.savepoint(async nested=>{
            if(row.action!=="CREATE"){
              const productId=textField(row.payload.productId,"product");
              const [product]=await nested`SELECT "updatedAt" FROM public."Product" WHERE "organizationId"=${org} AND "id"=${productId} FOR UPDATE`;
              if(!product)throw new RequestError("product_not_found",404);
              if(new Date(product.updatedAt).toISOString()!==row.expectedUpdatedAt)throw new RequestError("import_row_stale",409);
            }
            return await execute(nested,action(row),principal);
          });
        }catch(error){
          const code=error instanceof RequestError?error.message:error instanceof Error&&/^[a-z][a-z0-9_:-]{1,100}$/.test(error.message)?error.message:(error as {code?:string}).code;
          errorCode=code==='23505'?"record_conflict":code&&/^[A-Za-z0-9_:-]{1,100}$/.test(code)?code:"import_row_failed";
        }
        await tx`UPDATE public."CatalogImportRow" SET "state"=${errorCode?"ERROR":row.action==="STAGE"?"STAGED":"APPLIED"},
          "attempts"="attempts"+1,"errorCode"=${errorCode},"result"=${result===null?null:tx.json(result as never)},"updatedAt"=now() WHERE "id"=${row.id}`;
        const done=current.processedRows+1,failed=current.failedRows+(errorCode?1:0),state=done===current.expectedRows?(failed?'PARTIAL':'SUCCEEDED'):'RUNNING';
        await tx`UPDATE public."CatalogImportRun" SET "processedRows"=${done},"failedRows"=${failed},"state"=${state},"version"="version"+1,"updatedAt"=now()
          WHERE "organizationId"=${org} AND "id"=${id}`;
        return true;
      });
      if(!didWork)break;
    }
    const [current]=await sql`SELECT ${sql.unsafe(summary)} FROM public."CatalogImportRun" WHERE "organizationId"=${org} AND "id"=${id}`;
    return json({...current,batchProcessed:processed});
  }
  if((part==="cancel"||part==="retry")&&req.method==="POST"){
    const body=await req.json();if(body.confirmed!==true)throw new RequestError("confirmation_required");
    const version=integer(body.expectedVersion,"expected_version",1,2_000_000_000);
    return json(await once(sql,req,principal,route,body,async tx=>{
      if(part==="retry")await lockImportQuota(tx,org);
      const [current]=await tx`SELECT * FROM public."CatalogImportRun" WHERE "organizationId"=${org} AND "id"=${id} FOR UPDATE`;
      if(current.version!==version)throw new RequestError("import_version_conflict",409);
      if(part==="retry"){
        if(current.state!=="PARTIAL")throw new RequestError("import_not_retryable",409);
        await checkImportCapacity(tx,org,{runs:1,rows:current.expectedRows,bytes:current.payloadBytes});
        const rows=await tx`UPDATE public."CatalogImportRow" SET "state"='PENDING',"errorCode"=NULL,"updatedAt"=now()
          WHERE "organizationId"=${org} AND "runId"=${id} AND "state"='ERROR' AND "attempts"<3 RETURNING "id"`;
        if(!rows.length)throw new RequestError("import_retry_limit",409);
        await tx`UPDATE public."CatalogImportRun" SET "processedRows"="processedRows"-${rows.length},"failedRows"="failedRows"-${rows.length},"state"='QUEUED',
          "version"="version"+1,"updatedAt"=now() WHERE "organizationId"=${org} AND "id"=${id}`;
      }else{
        if(!['UPLOADING','QUEUED','RUNNING'].includes(current.state))throw new RequestError("import_not_cancelable",409);
        await tx`UPDATE public."CatalogImportRun" SET "state"='CANCELED',"version"="version"+1,"updatedAt"=now() WHERE "organizationId"=${org} AND "id"=${id}`;
      }
      const [updated]=await tx`SELECT * FROM public."CatalogImportRun" WHERE "organizationId"=${org} AND "id"=${id}`;
      await outbox(tx,org,"import."+part,{id,actor:principal.actor});return updated;
    }));
  }
  return json({error:"not_found"},404);
}
