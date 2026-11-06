import {canonical,digest,integer,retryDelay,textField} from "./core-domain.ts";
import {once,outbox,type Sql} from "./core-store.ts";
import {jsonObject,jsonParam} from "./database-json.ts";
import {RequestError,type Principal} from "./request-context.ts";
const topics=["catalog.product_changed","inventory.changed","channel.offer_changed","channel.mappings_changed","catalog.variants_grouped","catalog.variants_ungrouped"];
const statuses=["PENDING","RETRY","PROCESSING","DEAD","DELIVERED","CANCELED"];
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
function reason(value:unknown){const result=textField(value,"reason",500);if(result.length<5)throw new RequestError("invalid_reason");return result;}
function destination(value:unknown,environment:string){
  let url:URL;try{url=new URL(textField(value,"webhook_url",2048));}catch{throw new RequestError("invalid_webhook_url");}
  const test=environment==="TEST"&&Deno.env.get("CATALOG_DELIVERY_ALLOW_LOOPBACK_TEST")==="true"&&url.hostname==="127.0.0.1"&&url.protocol==="http:";
  if(!test&&(url.protocol!=="https:"||url.port&&url.port!=="443"||/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)||url.hostname.includes(":")||url.hostname==="localhost"||/\.(localhost|local|internal)$/.test(url.hostname)))throw new RequestError("invalid_webhook_url");
  if(url.username||url.password||url.search||url.hash)throw new RequestError("invalid_webhook_url");
  return url.toString();
}
async function verifyReceipt(secret:string,body:Record<string,unknown>,expected:Record<string,unknown>){
  const ack=jsonObject(body.ack),timestamp=body.timestamp,signature=body.signature;
  if(Object.keys(ack).sort().join(",")!=="connectionId,deliveryId,eventId,payloadHash,status"||
    !["ACCEPTED","DUPLICATE"].includes(String(ack.status))||Object.entries(expected).some(([key,value])=>ack[key]!==value))throw new RequestError("delivery_receipt_mismatch",409);
  if(secret.length<32)throw new RequestError("delivery_signing_not_configured",503);
  if(typeof timestamp!=="string"||!/^\d{10}$/.test(timestamp)||Math.abs(Date.now()-Number(timestamp)*1000)>300000||typeof signature!=="string"||!/^v1=[a-f0-9]{64}$/.test(signature))throw new RequestError("delivery_receipt_invalid",401);
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
  const bytes=Uint8Array.from(signature.slice(3).match(/../g)!,hex=>parseInt(hex,16));
  if(!await crypto.subtle.verify("HMAC",key,bytes,new TextEncoder().encode("catalog-delivery-ack-v1\n"+timestamp+"\n"+canonical(ack))))throw new RequestError("delivery_receipt_invalid",401);
  return {ack,timestamp,signature};
}
async function records(sql:Sql,org:string,webhookId:string,status:string,cursor:string,limit:number){
  return await sql`SELECT d."id",d."eventId",w."connectionId",d."generation",d."url",d."status",d."version",d."attempts",
    d."availableAt",d."lastError",d."createdAt",d."deliveredAt",d."receipt"->'ack' AS receipt
    FROM public."OutboxDelivery" d JOIN public."ChannelWebhook" w ON w."organizationId"=d."organizationId" AND w."id"=d."webhookId"
    WHERE d."organizationId"=${org} AND (${webhookId}='' OR d."webhookId"=${webhookId}) AND (${status}='' OR d."status"=${status})
      AND (${cursor}='' OR (d."createdAt",d."id")<(SELECT "createdAt","id" FROM public."OutboxDelivery" WHERE "organizationId"=${org} AND "id"=${cursor}))
    ORDER BY d."createdAt" DESC,d."id" DESC LIMIT ${limit}`;
}

export async function handleDeliveries(req:Request,route:string,url:URL,sql:Sql,principal:Principal):Promise<Response|null>{
  const org=principal.organizationId,endpoint=route.match(/^\/v1\/channels\/([^/]+)\/webhook$/);
  if(endpoint){
    const id=textField(endpoint[1],"connection");
    const [connection]=await sql`SELECT "adapter","environment","mode" FROM public."ChannelConnection" WHERE "organizationId"=${org} AND "id"=${id}`;
    if(!connection)throw new RequestError("channel_not_found",404);
    if(connection.adapter!=="OWN_STORE")throw new RequestError("unsupported_operation",422);
    if(req.method==="GET"){
      const [webhook]=await sql`SELECT * FROM public."ChannelWebhook" WHERE "organizationId"=${org} AND "connectionId"=${id}`;
      if(!webhook)return json({webhook:null,topics,deliveries:[],stats:[],nextCursor:null});
      const status=url.searchParams.get("status")||"";
      if(status&&!statuses.includes(status))throw new RequestError("invalid_delivery_status");
      const stats=await sql`SELECT "status",count(*)::int AS count FROM public."OutboxDelivery" WHERE "organizationId"=${org} AND "webhookId"=${webhook.id} GROUP BY "status"`;
      const rows=await records(sql,org,webhook.id,status,url.searchParams.get("cursor")||"",21),deliveries=rows.slice(0,20);
      return json({webhook,topics,stats,deliveries,nextCursor:rows.length>20?deliveries.at(-1)?.id:null});
    }
    if(req.method!=="POST")throw new RequestError("unsupported_operation",405);
    const body=await req.json();if(body.confirmed!==true)throw new RequestError("confirmation_required");
    const why=reason(body.reason),version=integer(body.expectedVersion,"expected_version",0,2_000_000_000);
    const target=destination(body.url,connection.environment),secretRef=textField(body.secretRef,"delivery_secret_ref",104);
    if(!/^CATALOG_DELIVERY_SECRET_[A-Z0-9_]{1,80}$/.test(secretRef))throw new RequestError("invalid_delivery_secret_ref");
    if(!Array.isArray(body.topics)||!body.topics.length||body.topics.length>topics.length||body.topics.some((t:unknown)=>typeof t!=="string"||!topics.includes(t)))throw new RequestError("invalid_delivery_topics");
    const chosen=Array.from(new Set<string>(body.topics)).sort(),state=body.state;
    if(!["PAUSED","ACTIVE"].includes(state))throw new RequestError("invalid_webhook_state");
    return json(await once(sql,req,principal,route,body,async tx=>{
      const [channel]=await tx`SELECT "environment","mode" FROM public."ChannelConnection" WHERE "organizationId"=${org} AND "id"=${id} FOR SHARE`;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"webhook-config:"+org},0))`;
      if(state==="ACTIVE"){
        if(channel.environment!=="TEST")throw new RequestError("production_cutover_not_enabled",409);
        if(channel.mode!=="ACTIVE")throw new RequestError("channel_not_active",409);
        if((Deno.env.get(secretRef)||"").length<32)throw new RequestError("delivery_signing_not_configured",503);
      }
      const [old]=await tx`SELECT * FROM public."ChannelWebhook" WHERE "organizationId"=${org} AND "connectionId"=${id} FOR UPDATE`;
      if((old?.version||0)!==version)throw new RequestError("webhook_version_conflict",409);
      if(!old){const [count]=await tx`SELECT count(*)::int AS total FROM public."ChannelWebhook" WHERE "organizationId"=${org}`;
        if(count.total>=10)throw new RequestError("webhook_limit",429);}
      const changed=old&&await digest({url:old.url,secretRef:old.secretRef,topics:typeof old.topics==="string"?JSON.parse(old.topics):old.topics})!==await digest({url:target,secretRef,topics:chosen});
      let saved;
      if(old){[saved]=await tx`UPDATE public."ChannelWebhook" SET "url"=${target},"secretRef"=${secretRef},"topics"=${tx.json(chosen)},"state"=${state},
        "generation"="generation"+${changed?1:0},"version"="version"+1,"updatedAt"=clock_timestamp() WHERE "organizationId"=${org} AND "id"=${old.id} RETURNING *`;
      }else{[saved]=await tx`INSERT INTO public."ChannelWebhook" ("id","organizationId","connectionId","url","secretRef","topics","state","updatedAt")
        VALUES (${crypto.randomUUID()},${org},${id},${target},${secretRef},${tx.json(chosen)},${state},clock_timestamp()) RETURNING *`;}
      let canceled=0;
      if(changed){const rows=await tx`UPDATE public."OutboxDelivery" SET "status"='CANCELED',"leaseToken"=null,"leaseUntil"=null,"lastError"='ENDPOINT_CHANGED',"version"="version"+1
        WHERE "organizationId"=${org} AND "webhookId"=${saved.id} AND "status" NOT IN ('DELIVERED','CANCELED') RETURNING "id"`;canceled=rows.length;}
      await outbox(tx,org,"delivery.configured",{connectionId:id,webhookId:saved.id,version:saved.version,generation:saved.generation,state,reason:why,actor:principal.actor,canceled});
      if(!old||changed)await outbox(tx,org,"channel.refresh_requested",{connectionId:id});
      return {webhook:saved,canceled};
    }));
  }
  if(!route.startsWith("/v1/sync/deliveries"))return null;
  if(route==="/v1/sync/deliveries"&&req.method==="GET"){
    const status=url.searchParams.get("status")||"";
    if(status&&!statuses.includes(status))throw new RequestError("invalid_delivery_status");
    const limit=Math.min(100,Math.max(1,Math.trunc(Number(url.searchParams.get("limit")))||20));
    const rows=await records(sql,org,url.searchParams.get("webhookId")||"",status,url.searchParams.get("cursor")||"",limit+1),items=rows.slice(0,limit);
    return json({items,nextCursor:rows.length>limit?items.at(-1)?.id:null});
  }
  if(route==="/v1/sync/deliveries/claim"&&req.method==="POST"){
    const body=await req.json(),limit=integer(body.limit??1,"limit",1,100);
    return json(await once(sql,req,principal,route,body,async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"delivery-claims:"+org},0))`;
      await tx`UPDATE public."OutboxDelivery" SET "status"='DEAD',"leaseToken"=null,"leaseUntil"=null,"lastError"='LEASE_EXHAUSTED',"version"="version"+1
        WHERE "organizationId"=${org} AND "status"='PROCESSING' AND "attempts">=8 AND "leaseUntil"<statement_timestamp()`;
      const [usage]=await tx`SELECT count(*)::int AS count FROM public."OutboxDelivery" WHERE "organizationId"=${org} AND "status"='PROCESSING' AND "leaseUntil">statement_timestamp()`;
      const jobs=await tx`SELECT d."id",w."connectionId" FROM public."OutboxDelivery" d JOIN public."ChannelWebhook" w ON w."organizationId"=d."organizationId" AND w."id"=d."webhookId"
        JOIN public."ChannelConnection" c ON c."organizationId"=w."organizationId" AND c."id"=w."connectionId"
        WHERE d."organizationId"=${org} AND w."state"='ACTIVE' AND c."mode"='ACTIVE' AND c."environment"='TEST' AND c."adapter"='OWN_STORE'
          AND d."generation"=w."generation" AND d."attempts"<8 AND ((d."status" IN ('PENDING','RETRY') AND d."availableAt"<=statement_timestamp()) OR (d."status"='PROCESSING' AND d."leaseUntil"<statement_timestamp()))
        ORDER BY d."availableAt",d."id" LIMIT ${Math.max(0,Math.min(limit,100-usage.count))} FOR UPDATE OF d SKIP LOCKED`;
      const items=[];
      for(const job of jobs){const [saved]=await tx`UPDATE public."OutboxDelivery" SET "status"='PROCESSING',"attempts"="attempts"+1,"version"="version"+1,
        "leaseToken"=${crypto.randomUUID()},"leaseUntil"=clock_timestamp()+interval '60 seconds' WHERE "organizationId"=${org} AND "id"=${job.id}
        RETURNING "id","payload","url","secretRef","generation","attempts","leaseToken","leaseUntil"`;items.push({...saved,connectionId:job.connectionId});}
      return {items,inFlight:usage.count+items.length};
    }));
  }
  const action=route.match(/^\/v1\/sync\/deliveries\/([^/]+)\/(complete|fail|retry)$/);
  if(action&&req.method==="POST"){
    const id=textField(action[1],"delivery"),kind=action[2],body=await req.json();
    return json(await once(sql,req,principal,route,body,async tx=>{
      const [job]=await tx`SELECT d.*,w."generation" AS "currentGeneration" FROM public."OutboxDelivery" d JOIN public."ChannelWebhook" w ON w."organizationId"=d."organizationId" AND w."id"=d."webhookId"
        WHERE d."organizationId"=${org} AND d."id"=${id} FOR UPDATE OF d`;
      if(!job)throw new RequestError("delivery_not_found",404);
      if(kind==="retry"){
        const why=reason(body.reason),version=integer(body.expectedVersion,"expected_version",1,2_000_000_000);
        if(body.confirmed!==true||job.status!=="DEAD")throw new RequestError("delivery_retry_confirmation_required",409);
        if(job.version!==version)throw new RequestError("delivery_version_conflict",409);
        if(job.generation!==job.currentGeneration)throw new RequestError("delivery_target_changed",409);
        await tx`UPDATE public."OutboxDelivery" SET "status"='RETRY',"attempts"=0,"version"="version"+1,"availableAt"=clock_timestamp(),"lastError"=null,"leaseToken"=null,"leaseUntil"=null WHERE "organizationId"=${org} AND "id"=${id}`;
        await outbox(tx,org,"delivery.retried",{deliveryId:id,reason:why,actor:principal.actor});return {id,status:"RETRY"};
      }
      if(job.status!=="PROCESSING"||job.leaseToken!==body.leaseToken||new Date(job.leaseUntil).getTime()<=Date.now()||job.generation!==job.currentGeneration)throw new RequestError("delivery_lease_conflict",409);
      if(kind==="complete"){
        const envelope=jsonObject(job.payload),receipt=await verifyReceipt(Deno.env.get(job.secretRef)||"",body,{deliveryId:id,eventId:job.eventId,connectionId:envelope.connectionId,payloadHash:await digest(envelope)});
        await tx`UPDATE public."OutboxDelivery" SET "status"='DELIVERED',"receipt"=${jsonParam(tx,receipt)},"deliveredAt"=clock_timestamp(),"leaseToken"=null,"leaseUntil"=null,"lastError"=null,"version"="version"+1 WHERE "organizationId"=${org} AND "id"=${id}`;
        return {id,status:"DELIVERED"};
      }
      const error=typeof body.errorCode==="string"&&/^[A-Z0-9_]{1,80}$/.test(body.errorCode)?body.errorCode:"DELIVERY_FAILED";
      const status=job.attempts>=8?"DEAD":"RETRY";
      const delay=Math.max(retryDelay(job.attempts),integer(body.retryAfterSeconds??0,"retry_after",0,3600));
      await tx`UPDATE public."OutboxDelivery" SET "status"=${status},"lastError"=${error},"availableAt"=clock_timestamp()+${delay}*interval '1 second',"leaseToken"=null,"leaseUntil"=null,"version"="version"+1 WHERE "organizationId"=${org} AND "id"=${id}`;
      return {id,status};
    }));
  }
  throw new RequestError("unsupported_operation",405);
}
