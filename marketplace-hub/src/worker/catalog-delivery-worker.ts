import {pathToFileURL} from "node:url";
import {DeliveryError,deliverySignature,limitedDeliveryJson,validateAck,validateEnvelope,verifyDeliverySignature,type DeliveryEnvelope} from "./delivery-contract.js";
import {sendDelivery,type DeliveryTransportOptions} from "./delivery-transport.js";
import {importWorkerBackoff} from "./catalog-import-worker.js";
type Job={id:string;payload:DeliveryEnvelope;url:string;secretRef:string;connectionId:string;leaseToken:string;leaseUntil:string};
type Result={claimed:number;delivered:number;failed:number;uncertain:number};
type Options={baseUrl:string;key:string;allowedHosts:string[];secretForRef:(ref:string)=>string|undefined;allowLoopbackTest?:boolean;
 maxEvents?:number;signal?:AbortSignal;fetchCore?:typeof fetch;transport?:typeof sendDelivery;onError?:(event:{deliveryId:string;code:string})=>void};
class CoreError extends Error{constructor(readonly status:number,readonly jobFailure=false){super("CORE_API_"+status);}}
function validate(options:Options){
 let url:URL;try{url=new URL(options.baseUrl);}catch{throw new DeliveryError("CORE_URL_REQUIRED");}
 if(url.username||url.password||url.search||url.hash||url.protocol!=="https:"&&!(url.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(url.hostname)))throw new DeliveryError("CORE_URL_INVALID");
 if(!options.key||!options.allowedHosts.length||!Number.isSafeInteger(options.maxEvents??5)||(options.maxEvents??5)<1||(options.maxEvents??5)>10)throw new DeliveryError("DELIVERY_WORKER_CONFIG_INVALID");
}
export async function deliveryWorkerCycle(options:Options):Promise<Result>{
 validate(options);const result:Result={claimed:0,delivered:0,failed:0,uncertain:0};
 const base=options.baseUrl.replace(/\/$/,""),fetcher=options.fetchCore??fetch;
 async function core(path:string,body:unknown){
  const operationKey=crypto.randomUUID();let last:unknown;
  for(let attempt=0;attempt<2;attempt++){
   try{
    const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000);
    const response=await fetcher(base+"/v1/sync/deliveries"+path,{method:"POST",redirect:"error",signal,
     headers:{"content-type":"application/json","x-catalog-hub-key":options.key,"idempotency-key":operationKey},body:JSON.stringify(body)});
    if(!response.ok){
     let jobFailure=false;
     try{const error=await limitedDeliveryJson(response,8192,signal) as {error?:unknown};
      jobFailure=["delivery_receipt_invalid","delivery_receipt_mismatch","delivery_signing_not_configured","delivery_lease_conflict"].includes(String(error.error));
     }catch{await response.body?.cancel().catch(()=>{});}
     throw new CoreError(response.status,jobFailure);
    }
    return await limitedDeliveryJson(response,65536,signal) as Record<string,unknown>;
   }catch(error){last=error;if(options.signal?.aborted||error instanceof CoreError&&error.status<500&&![408,429].includes(error.status))throw error;}
  }throw last;
 }
 for(let index=0;index<(options.maxEvents??5)&&!options.signal?.aborted;index++){
  const claimed=await core("/claim",{limit:1});
  if(!Array.isArray(claimed.items)||claimed.items.length>1)throw new DeliveryError("CORE_RESPONSE_INVALID");
  if(!claimed.items.length)break;
  const job=claimed.items[0] as Job;result.claimed++;let receipt;
  try{
   const payload=validateEnvelope(job.payload),until=Date.parse(job.leaseUntil);
   if(payload.deliveryId!==job.id||payload.connectionId!==job.connectionId||!/^CATALOG_DELIVERY_SECRET_[A-Z0-9_]{1,80}$/.test(job.secretRef)||
    typeof job.leaseToken!=="string"||!job.leaseToken||!Number.isFinite(until)||until-Date.now()<35000)throw new DeliveryError("DELIVERY_LEASE_TOO_SHORT");
   const secret=options.secretForRef(job.secretRef)||"",timestamp=String(Math.floor(Date.now()/1000));
   const transportOptions:DeliveryTransportOptions={allowedHosts:options.allowedHosts,allowLoopbackTest:options.allowLoopbackTest,signal:options.signal};
   const response=await (options.transport??sendDelivery)(job.url,payload,{"x-catalog-delivery-timestamp":timestamp,
    "x-catalog-delivery-signature":deliverySignature(secret,"event",timestamp,payload)},transportOptions);
   const ack=validateAck(response.data,payload);verifyDeliverySignature(secret,"ack",response.timestamp,response.signature,ack);
   receipt={ack,timestamp:response.timestamp,signature:response.signature};
  }catch(error){
   if(options.signal?.aborted)break;
   const code=error instanceof DeliveryError?error.code:"DELIVERY_UNAVAILABLE";options.onError?.({deliveryId:job.id,code});
   try{const failed=await core("/"+encodeURIComponent(job.id)+"/fail",{leaseToken:job.leaseToken,errorCode:code,retryAfterSeconds:error instanceof DeliveryError?error.retryAfterSeconds:0});
    if(!["RETRY","DEAD"].includes(String(failed.status)))throw new DeliveryError("CORE_RESPONSE_INVALID");result.failed++;
   }catch(problem){if(problem instanceof CoreError&&[401,403].includes(problem.status)&&!problem.jobFailure)throw problem;result.uncertain++;}
   continue;
  }
  try{
   const completed=await core("/"+encodeURIComponent(job.id)+"/complete",{leaseToken:job.leaseToken,...receipt});
   if(completed.id!==job.id||completed.status!=="DELIVERED")throw new DeliveryError("CORE_RESPONSE_INVALID");result.delivered++;
  }catch(error){
   if(options.signal?.aborted)break;
   if(error instanceof CoreError&&[401,403].includes(error.status)&&!error.jobFailure)throw error;
   // The remote inbox committed. Preserve the lease on an uncertain core ack;
   // receiver dedup and lease expiry recover this outcome after a restart.
   result.uncertain++;options.onError?.({deliveryId:job.id,code:"DELIVERY_ACK_UNCERTAIN"});
  }
 }return result;
}
function wait(ms:number,signal:AbortSignal){return new Promise<void>(resolve=>{
 if(signal.aborted)return resolve();const end=()=>{clearTimeout(timer);signal.removeEventListener("abort",end);resolve();};
 const timer=setTimeout(end,ms);signal.addEventListener("abort",end,{once:true});
});}
async function main(){
 if(process.env.CATALOG_DELIVERY_WORKER_ENABLED!=="true")throw new DeliveryError("DELIVERY_WORKER_DISABLED");
 const controller=new AbortController(),stop=()=>controller.abort();
 const options:Options={baseUrl:process.env.CATALOG_HUB_API_URL||"",key:process.env.CATALOG_HUB_API_KEY||"",
  allowedHosts:(process.env.CATALOG_DELIVERY_ALLOWED_HOSTS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean),
  secretForRef:ref=>process.env[ref],allowLoopbackTest:process.env.CATALOG_DELIVERY_ALLOW_LOOPBACK_TEST==="true",
  maxEvents:Number(process.env.CATALOG_DELIVERY_MAX_PER_CYCLE||5),signal:controller.signal,
  onError:event=>console.error(JSON.stringify({event:"delivery.error",...event}))};
 validate(options);for(const signal of ["SIGTERM","SIGINT"] as const)process.once(signal,stop);
 const once=process.argv.includes("--once");let failures=0,lastHeartbeat=0;
 try{do{
  let failed=false;
  try{
   const result=await deliveryWorkerCycle(options);failed=result.failed>0||result.uncertain>0;
   if(result.claimed||Date.now()-lastHeartbeat>=60000){console.log(JSON.stringify({event:"delivery.progress",...result}));lastHeartbeat=Date.now();}
   if(once){if(failed)process.exitCode=1;break;}
  }catch(error){
   if(controller.signal.aborted)break;failed=true;
   const fatal=error instanceof CoreError&&[400,401,403,404].includes(error.status)&&!error.jobFailure||error instanceof DeliveryError&&error.status<500;
   console.error(JSON.stringify({event:"delivery.worker_error",code:error instanceof CoreError?error.message:error instanceof DeliveryError?error.code:"CORE_UNAVAILABLE"}));
   if(once||fatal){process.exitCode=1;break;}
  }
  failures=failed?failures+1:0;await wait(failed?importWorkerBackoff(failures):1500,controller.signal);
 }while(!controller.signal.aborted);}finally{for(const signal of ["SIGTERM","SIGINT"] as const)process.removeListener(signal,stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)void main().catch(()=>{console.error("delivery_worker_configuration_error");process.exitCode=1;});
