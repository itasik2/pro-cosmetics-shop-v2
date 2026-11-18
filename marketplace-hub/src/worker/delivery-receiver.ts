import type postgres from "postgres";
import {DeliveryError,deliveryHash,deliverySignature,limitedDeliveryJson,validateEnvelope,verifyDeliverySignature,type DeliveryEnvelope} from "./delivery-contract.js";

/** persist must atomically store the immutable hash and enqueue the notification.
 * ACCEPTED confirms durable inbox receipt, never publication of an offer. */
export function createDeliveryReceiver(options:{organizationId:string;connectionId:string;secret:string;
  persist:(event:DeliveryEnvelope,hash:string)=>Promise<"ACCEPTED"|"DUPLICATE">}){
  return async(request:Request):Promise<Response>=>{
    try{
      if(request.method!=="POST")throw new DeliveryError("METHOD_NOT_ALLOWED",405);
      if((request.headers.get("content-type")||"").split(";")[0].trim()!=="application/json")throw new DeliveryError("JSON_REQUIRED",415);
      const raw=await limitedDeliveryJson(new Response(request.body,{headers:request.headers}),8192,AbortSignal.any([request.signal,AbortSignal.timeout(10000)])),event=validateEnvelope(raw);
      if(event.organizationId!==options.organizationId||event.connectionId!==options.connectionId)throw new DeliveryError("DELIVERY_CONTEXT_MISMATCH",403);
      verifyDeliverySignature(options.secret,"event",request.headers.get("x-catalog-delivery-timestamp"),request.headers.get("x-catalog-delivery-signature"),event);
      const payloadHash=deliveryHash(event),status=await options.persist(event,payloadHash);
      if(!["ACCEPTED","DUPLICATE"].includes(status))throw new DeliveryError("INBOX_COMMIT_FAILED",503);
      const ack={deliveryId:event.deliveryId,eventId:event.eventId,connectionId:event.connectionId,payloadHash,status};
      const timestamp=String(Math.floor(Date.now()/1000));
      return new Response(JSON.stringify(ack),{headers:{"content-type":"application/json","cache-control":"no-store",
        "x-catalog-ack-timestamp":timestamp,"x-catalog-ack-signature":deliverySignature(options.secret,"ack",timestamp,ack)}});
    }catch(error){return new Response(JSON.stringify({error:error instanceof DeliveryError?error.code:"INBOX_COMMIT_FAILED"}),
      {status:error instanceof DeliveryError?error.status:503,headers:{"content-type":"application/json","cache-control":"no-store"}});}
  };
}
/** The receiver's own database; install integrations/catalog-delivery-inbox.sql
 * there before wiring this adapter. It does not hold a second physical balance. */
export function postgresDeliveryInbox(sql:ReturnType<typeof postgres>){
  return async(event:DeliveryEnvelope,hash:string):Promise<"ACCEPTED"|"DUPLICATE">=>{
    return await sql.begin(async tx=>{
      const rows=await tx`INSERT INTO public."CatalogDeliveryInbox" ("organizationId","connectionId","deliveryId","eventId","payloadHash","payload")
        VALUES (${event.organizationId},${event.connectionId},${event.deliveryId},${event.eventId},${hash},${tx.json(event)})
        ON CONFLICT ("organizationId","connectionId","deliveryId") DO NOTHING RETURNING "deliveryId"`;
      if(rows.length)return "ACCEPTED";
      const [old]=await tx`SELECT "payloadHash" FROM public."CatalogDeliveryInbox" WHERE "organizationId"=${event.organizationId} AND "connectionId"=${event.connectionId} AND "deliveryId"=${event.deliveryId}`;
      if(old.payloadHash!==hash)throw new DeliveryError("DELIVERY_PAYLOAD_CONFLICT",409);
      return "DUPLICATE";
    }) as "ACCEPTED"|"DUPLICATE";
  };
}
