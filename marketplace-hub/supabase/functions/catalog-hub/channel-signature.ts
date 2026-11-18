import {canonical} from "./core-domain.ts";
import {RequestError} from "./request-context.ts";
export async function verifyChannelSignature(input:{secret:string;connectionId:string;timestamp:string|null;signature:string|null;body:unknown;now?:number}){
  if(input.secret.length<32)throw new RequestError("channel_signing_not_configured",503);
  if(!input.timestamp||!/^\d{10}$/.test(input.timestamp)||Math.abs((input.now??Date.now())-Number(input.timestamp)*1000)>300000)
    throw new RequestError("channel_signature_expired",401);
  if(!input.signature||!/^v1=[a-f0-9]{64}$/.test(input.signature))throw new RequestError("channel_signature_invalid",401);
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(input.secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
  const signature=Uint8Array.from(input.signature.slice(3).match(/../g)!,hex=>parseInt(hex,16));
  const bytes=new TextEncoder().encode(input.timestamp+"."+input.connectionId+"."+canonical(input.body));
  if(!await crypto.subtle.verify("HMAC",key,signature,bytes))throw new RequestError("channel_signature_invalid",401);
}
