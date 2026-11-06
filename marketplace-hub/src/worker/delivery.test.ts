import test from "node:test";
import assert from "node:assert/strict";
import {deliveryHash,deliverySignature,verifyDeliverySignature,validateEnvelope,validateAck,type DeliveryEnvelope} from "./delivery-contract.js";
import {createDeliveryReceiver} from "./delivery-receiver.js";
import {sendDelivery} from "./delivery-transport.js";
import {deliveryWorkerCycle} from "./catalog-delivery-worker.js";
const secret="synthetic-delivery-unit-secret-32-bytes",key="synthetic-core-key";
const event:DeliveryEnvelope={version:1,deliveryId:"delivery-1",eventId:"event-1",organizationId:"org-a",connectionId:"channel-a",generation:1,type:"inventory.changed",time:"2026-11-06T00:00:00Z",data:{refresh:"channel-export"}};
const timestamp=()=>String(Math.floor(Date.now()/1000));
const ack=()=>({deliveryId:event.deliveryId,eventId:event.eventId,connectionId:event.connectionId,payloadHash:deliveryHash(event),status:"ACCEPTED" as const});
const signed=()=>{const data=ack(),time=timestamp();return {data,timestamp:time,signature:deliverySignature(secret,"ack",time,data)};};
const job=()=>({id:event.deliveryId,payload:event,url:"https://receiver.test/inbox",secretRef:"CATALOG_DELIVERY_SECRET_TEST",connectionId:event.connectionId,leaseToken:"lease-1",leaseUntil:new Date(Date.now()+60000).toISOString()});
const options={baseUrl:"http://127.0.0.1:8000",key,allowedHosts:["receiver.test"],secretForRef:()=>secret,maxEvents:1};
function coreFixture(complete?:(init?:RequestInit)=>Promise<Response>){const paths:string[]=[],keys:string[]=[];const fetchCore:typeof fetch=async(input,init)=>{
 const path=new URL(String(input)).pathname;paths.push(path);keys.push(new Headers(init?.headers).get("idempotency-key")!);
 assert.equal(new Headers(init?.headers).get("x-catalog-hub-key"),key);assert.equal(init?.redirect,"error");
 if(path.endsWith("/claim"))return Response.json({items:[job()]});
 if(path.endsWith("/complete"))return complete?complete(init):Response.json({id:event.deliveryId,status:"DELIVERED"});
 return Response.json({id:event.deliveryId,status:"RETRY"});
};return {fetchCore,paths,keys};}
test("event and receipt signatures are domain-separated, fresh and bound to exact content",()=>{
 const time=timestamp();verifyDeliverySignature(secret,"event",time,deliverySignature(secret,"event",time,event),event);
 assert.throws(()=>verifyDeliverySignature(secret,"ack",time,deliverySignature(secret,"event",time,event),event),/SIGNATURE/);
 assert.throws(()=>verifyDeliverySignature(secret,"event",time,deliverySignature(secret,"event",time,event),{...event,connectionId:"other"}),/SIGNATURE/);
 assert.throws(()=>verifyDeliverySignature(secret,"event",String(Number(time)-301),deliverySignature(secret,"event",time,event),event),/SIGNATURE/);
 assert.throws(()=>validateEnvelope({...event,data:{refresh:"channel-export",purchasePrice:100}}),/INVALID_ENVELOPE/);
 assert.throws(()=>validateEnvelope({...event,actor:"private"}),/INVALID_ENVELOPE/);
 assert.throws(()=>validateAck({...ack(),payloadHash:"0".repeat(64)},event),/MISMATCH/);
});
test("receiver signs an ACK only after its durable inbox callback succeeds",async()=>{
 let commits=0;const receive=createDeliveryReceiver({organizationId:event.organizationId,connectionId:event.connectionId,secret,persist:async()=>{commits++;return commits===1?"ACCEPTED":"DUPLICATE";}});
 const request=()=>{const time=timestamp();return new Request("https://receiver.test/inbox",{method:"POST",headers:{"content-type":"application/json","x-catalog-delivery-timestamp":time,"x-catalog-delivery-signature":deliverySignature(secret,"event",time,event)},body:JSON.stringify(event)});};
 const first=await receive(request());assert.equal(first.status,200);const body=await first.json();assert.equal(body.status,"ACCEPTED");
 verifyDeliverySignature(secret,"ack",first.headers.get("x-catalog-ack-timestamp"),first.headers.get("x-catalog-ack-signature"),body);
 assert.equal((await (await receive(request())).json()).status,"DUPLICATE");
 const failing=createDeliveryReceiver({organizationId:event.organizationId,connectionId:event.connectionId,secret,persist:async()=>{throw new Error("database secret must not leak");}});
 const error=await failing(request());assert.equal(error.status,503);assert.equal(error.headers.get("x-catalog-ack-signature"),null);assert.ok(!(await error.text()).includes("database secret"));
 const bad=new Request("https://receiver.test/inbox",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(event)});assert.equal((await receive(bad)).status,401);assert.equal(commits,2);
});
test("receiver rejects foreign context and oversized or unsupported bodies before persisting",async()=>{
 const receive=createDeliveryReceiver({organizationId:"other",connectionId:event.connectionId,secret,persist:async()=>assert.fail("must not commit")});
 assert.equal((await receive(new Request("https://receiver.test/inbox",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(event)}))).status,403);
 assert.equal((await receive(new Request("https://receiver.test/inbox"))).status,405);
 assert.equal((await receive(new Request("https://receiver.test/inbox",{method:"POST",headers:{"content-type":"application/json","content-length":"99999"},body:"{}"}))).status,400);
});
test("outbound transport rejects undisclosed hosts, redirects and private DNS, including IPv6-mapped addresses",async()=>{
 const fetchImpl:typeof fetch=async()=>assert.fail("blocked destination must not be contacted");
 for(const url of ["http://receiver.test/inbox","https://receiver.test/inbox?key=x","https://user:pass@receiver.test/inbox","https://other.test/inbox","http://127.0.0.1/inbox"]){
  await assert.rejects(sendDelivery(url,event,{}, {allowedHosts:["receiver.test"],fetchImpl}),/TARGET_BLOCKED/);
 }
 for(const address of ["127.0.0.1","10.0.0.1","169.254.169.254","::ffff:7f00:1","fd00::1"]){
  await assert.rejects(sendDelivery("https://receiver.test/inbox",event,{}, {allowedHosts:["receiver.test"],resolve:async()=>[{address:"8.8.8.8",family:4},{address,family:address.includes(":")?6:4}],fetchImpl}),/DNS_BLOCKED/);
 }
 let calls=0;await assert.rejects(sendDelivery("https://receiver.test/inbox",event,{}, {allowedHosts:["receiver.test"],resolve:async()=>[{address:"8.8.8.8",family:4}],fetchImpl:async(_url,init)=>{calls++;assert.equal(init?.redirect,"manual");return new Response(null,{status:302,headers:{location:"http://127.0.0.1"}});}}),/HTTP_302/);assert.equal(calls,1);
});
test("transport bounds receiver Retry-After and response size",async()=>{
 const base={allowedHosts:["receiver.test"],resolve:async()=>[{address:"8.8.8.8",family:4}]};
 await assert.rejects(sendDelivery("https://receiver.test/inbox",event,{}, {...base,fetchImpl:async()=>new Response(null,{status:429,headers:{"retry-after":"99999"}})}),(e:any)=>e.code==="DELIVERY_HTTP_429"&&e.retryAfterSeconds===3600);
 await assert.rejects(sendDelivery("https://receiver.test/inbox",event,{}, {...base,fetchImpl:async()=>new Response('"'+"x".repeat(9000)+'"',{headers:{"content-type":"application/json"}})}),/TOO_LARGE/);
});
test("worker never forwards the core API key and completes only a verified signed receipt",async()=>{
 const fixture=coreFixture();
 const result=await deliveryWorkerCycle({...options,fetchCore:fixture.fetchCore,transport:async(_url,payload,headers)=>{
  assert.equal(headers["x-catalog-hub-key"],undefined);assert.ok(!JSON.stringify(headers).includes(key));
  verifyDeliverySignature(secret,"event",headers["x-catalog-delivery-timestamp"],headers["x-catalog-delivery-signature"],payload);return signed();
 }});
 assert.deepEqual(result,{claimed:1,delivered:1,failed:0,uncertain:0});assert.ok(fixture.paths.at(-1)?.endsWith("/complete"));
});
test("plain HTTP 200, a forged signature or a mismatched receipt cannot mark delivery successful",async()=>{
 for(const reply of [{data:{ok:true},timestamp:timestamp(),signature:null},{...signed(),signature:"v1="+"0".repeat(64)},{...signed(),data:{...ack(),connectionId:"other"}}]){
  const fixture=coreFixture();const result=await deliveryWorkerCycle({...options,fetchCore:fixture.fetchCore,transport:async()=>reply});
  assert.equal(result.delivered,0);assert.equal(result.failed,1);assert.ok(fixture.paths.at(-1)?.endsWith("/fail"));
 }
});
test("lost core ACK retries its same idempotency key and preserves an uncertain lease instead of blind failure",async()=>{
 const fixture=coreFixture(async()=>{throw new Error("lost response");});const issues:string[]=[];
 const result=await deliveryWorkerCycle({...options,fetchCore:fixture.fetchCore,transport:async()=>signed(),onError:e=>issues.push(e.code)});
 assert.deepEqual(result,{claimed:1,delivered:0,failed:0,uncertain:1});assert.equal(fixture.keys[1],fixture.keys[2]);assert.ok(!fixture.paths.some(p=>p.endsWith("/fail")));assert.deepEqual(issues,["DELIVERY_ACK_UNCERTAIN"]);
});
test("revoked core credentials stop delivery and abort starts no requests",async()=>{
 await assert.rejects(deliveryWorkerCycle({...options,fetchCore:async()=>new Response(null,{status:403}),transport:async()=>assert.fail("unauthorized")}),/CORE_API_403/);
 const signal=AbortSignal.abort();const result=await deliveryWorkerCycle({...options,signal,fetchCore:async()=>assert.fail("aborted")});assert.equal(result.claimed,0);
});
test("a rejected recipient receipt is separate from revoked worker credentials",async()=>{
 const fixture=coreFixture(async()=>Response.json({error:"delivery_receipt_invalid"},{status:401}));
 const result=await deliveryWorkerCycle({...options,fetchCore:fixture.fetchCore,transport:async()=>signed()});
 assert.equal(result.uncertain,1);assert.equal(result.delivered,0);assert.ok(!fixture.paths.some(p=>p.endsWith("/fail")));
});
