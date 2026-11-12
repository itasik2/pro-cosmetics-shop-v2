import {lookup} from "node:dns/promises";
import {isIP} from "node:net";
import {Agent,fetch as undiciFetch} from "undici";
import {isBlockedAddress,pinnedSourceLookup} from "../ai/network.js";
import {DeliveryError,limitedDeliveryJson} from "./delivery-contract.js";
export type DeliveryTransportOptions={allowedHosts:string[];allowLoopbackTest?:boolean;signal?:AbortSignal;timeoutMs?:number;
 resolve?:(hostname:string)=>Promise<Array<{address:string;family:number}>>;fetchImpl?:typeof fetch};
function publicAddress(address:string){
 if(isBlockedAddress(address))return false;
 return isIP(address)!==6||/^[23][0-9a-f]{0,3}:/i.test(address)&&!/^2002:|^3fff:|^2001:(?:0{0,4}|0*2|0*10|0*20):/i.test(address);
}
async function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 let abort:()=>void=()=>{};
 try{return await Promise.race([promise,new Promise<never>((_,reject)=>{abort=()=>reject(new DeliveryError("DELIVERY_TIMEOUT"));if(signal.aborted)abort();else signal.addEventListener("abort",abort,{once:true});})]);}
 finally{signal.removeEventListener("abort",abort);}
}
export async function sendDelivery(urlValue:string,body:unknown,headers:Record<string,string>,options:DeliveryTransportOptions){
 let url:URL;try{url=new URL(urlValue);}catch{throw new DeliveryError("DELIVERY_TARGET_INVALID");}
 const test=options.allowLoopbackTest===true&&url.hostname==="127.0.0.1"&&url.protocol==="http:";
 if(!options.allowedHosts.includes(url.hostname.toLowerCase())||url.hostname.endsWith(".")||url.username||url.password||url.search||url.hash||
   !test&&(url.protocol!=="https:"||url.port&&url.port!=="443"||isIP(url.hostname)!==0))throw new DeliveryError("DELIVERY_TARGET_BLOCKED");
 const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(options.timeoutMs??10000)]):AbortSignal.timeout(options.timeoutMs??10000);
 if(signal.aborted)throw new DeliveryError("DELIVERY_TIMEOUT");
 const addresses=await abortable(test?Promise.resolve([{address:"127.0.0.1",family:4}]):(options.resolve??(hostname=>lookup(hostname,{all:true,verbatim:true})))(url.hostname),signal);
 if(!addresses.length||!test&&addresses.some(a=>!publicAddress(a.address)))throw new DeliveryError("DELIVERY_DNS_BLOCKED");
 const agent=options.fetchImpl?null:new Agent({connect:{lookup:pinnedSourceLookup(addresses[0])}});
 try{
  const init={method:"POST",redirect:"manual" as const,signal,headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)};
  const response=await abortable(options.fetchImpl?options.fetchImpl(url,init):undiciFetch(url,{...init,dispatcher:agent!}) as unknown as Promise<Response>,signal);
  if(response.status!==200){
   const raw=response.headers.get("retry-after")||"",seconds=/^\d+$/.test(raw)?Number(raw):(Date.parse(raw)-Date.now())/1000;
   await response.body?.cancel();throw new DeliveryError("DELIVERY_HTTP_"+response.status,400,Number.isFinite(seconds)?Math.max(0,Math.min(3600,Math.ceil(seconds))):0);
  }
  if((response.headers.get("content-type")||"").split(";")[0].trim()!=="application/json"){await response.body?.cancel();throw new DeliveryError("DELIVERY_RESPONSE_INVALID");}
  const data=await abortable(limitedDeliveryJson(response,8192,signal),signal);
  return {data,timestamp:response.headers.get("x-catalog-ack-timestamp"),signature:response.headers.get("x-catalog-ack-signature")};
 }finally{await agent?.destroy();}
}
