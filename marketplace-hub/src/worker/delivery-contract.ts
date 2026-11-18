import {createHash,createHmac,timingSafeEqual} from "node:crypto";
export const deliveryTopics=["catalog.product_changed","inventory.changed","channel.offer_changed","channel.mappings_changed","catalog.variants_grouped","catalog.variants_ungrouped","channel.refresh_requested"];
export type DeliveryEnvelope={version:1;deliveryId:string;eventId:string;organizationId:string;connectionId:string;generation:number;type:string;time:string;data:{refresh:"channel-export"}};
export type DeliveryAck={deliveryId:string;eventId:string;connectionId:string;payloadHash:string;status:"ACCEPTED"|"DUPLICATE"};
export class DeliveryError extends Error{constructor(readonly code:string,readonly status=400,readonly retryAfterSeconds=0){super(code);}}
export function canonicalDelivery(value:unknown):string{
  if(Array.isArray(value))return "["+value.map(canonicalDelivery).join(",")+"]";
  if(value&&typeof value==="object")return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+canonicalDelivery((value as Record<string,unknown>)[key])).join(",")+"}";
  return JSON.stringify(value)??"null";
}
export const deliveryHash=(value:unknown)=>createHash("sha256").update(canonicalDelivery(value)).digest("hex");
export function validateEnvelope(value:unknown):DeliveryEnvelope{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new DeliveryError("INVALID_ENVELOPE");
  const v=value as DeliveryEnvelope;
  if(Object.keys(v).sort().join(",")!=="connectionId,data,deliveryId,eventId,generation,organizationId,time,type,version"||v.version!==1||
    ![v.deliveryId,v.eventId,v.organizationId,v.connectionId].every(x=>typeof x==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(x))||
    !Number.isSafeInteger(v.generation)||v.generation<1||!deliveryTopics.includes(v.type)||typeof v.time!=="string"||!Number.isFinite(Date.parse(v.time))||
    !v.data||typeof v.data!=="object"||Object.keys(v.data).join(",")!=="refresh"||v.data.refresh!=="channel-export")throw new DeliveryError("INVALID_ENVELOPE");
  return v;
}
export function deliverySignature(secret:string,kind:"event"|"ack",timestamp:string,body:unknown){
  if(secret.length<32)throw new DeliveryError("DELIVERY_SECRET_NOT_CONFIGURED",503);
  return "v1="+createHmac("sha256",secret).update((kind==="event"?"catalog-delivery-v1":"catalog-delivery-ack-v1")+"\n"+timestamp+"\n"+canonicalDelivery(body)).digest("hex");
}
export function verifyDeliverySignature(secret:string,kind:"event"|"ack",timestamp:string|null,signature:string|null,body:unknown,now=Date.now()){
  if(!timestamp||!/^\d{10}$/.test(timestamp)||Math.abs(now-Number(timestamp)*1000)>300000||!signature||!/^v1=[a-f0-9]{64}$/.test(signature))throw new DeliveryError("DELIVERY_SIGNATURE_INVALID",401);
  const expected=deliverySignature(secret,kind,timestamp,body);
  if(!timingSafeEqual(Buffer.from(expected),Buffer.from(signature)))throw new DeliveryError("DELIVERY_SIGNATURE_INVALID",401);
}
export function validateAck(value:unknown,event:DeliveryEnvelope):DeliveryAck{
  const v=value as DeliveryAck;
  if(!v||typeof v!=="object"||Object.keys(v).sort().join(",")!=="connectionId,deliveryId,eventId,payloadHash,status"||
    !["ACCEPTED","DUPLICATE"].includes(v.status)||v.deliveryId!==event.deliveryId||v.eventId!==event.eventId||v.connectionId!==event.connectionId||v.payloadHash!==deliveryHash(event))throw new DeliveryError("DELIVERY_RECEIPT_MISMATCH",409);
  return v;
}
export async function limitedDeliveryJson(response:Response,maxBytes=8192,signal?:AbortSignal){
  if(Number(response.headers.get("content-length")||0)>maxBytes||!response.body)throw new DeliveryError("DELIVERY_RESPONSE_TOO_LARGE");
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  if(signal?.aborted){await reader.cancel();reader.releaseLock();throw new DeliveryError("DELIVERY_TIMEOUT",503);}
  const abort=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener("abort",abort,{once:true});
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();throw new DeliveryError("DELIVERY_RESPONSE_TOO_LARGE");}chunks.push(value);}}
  finally{signal?.removeEventListener("abort",abort);reader.releaseLock();}
  if(signal?.aborted)throw new DeliveryError("DELIVERY_TIMEOUT",503);
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes)) as unknown;}catch{throw new DeliveryError("DELIVERY_RESPONSE_INVALID");}
}
