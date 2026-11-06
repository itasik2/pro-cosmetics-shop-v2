// Actual loopback HTTP and PostgreSQL inbox; no live storefront is contacted.
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {createServer} from "node:http";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {spawn} from "node:child_process";
const require=createRequire(new URL("../marketplace-hub/package.json",import.meta.url)),postgres=require("postgres");
export async function runDeliveryChecks({baseUrl="http://127.0.0.1:8000",key,keyB,readOnlyKey,testDatabaseUrl="postgresql://catalog_test:catalog_test_only@127.0.0.1:55432/catalog_test"}){
 assert.equal(new URL(baseUrl).hostname,"127.0.0.1");const dbUrl=new URL(testDatabaseUrl);
 assert.equal(dbUrl.hostname,"127.0.0.1");assert.equal(dbUrl.port,"55432");assert.ok(["/catalog_test","/postgres"].includes(dbUrl.pathname));
 const db=postgres(testDatabaseUrl,{max:dbUrl.pathname==="/postgres"?1:3,prepare:false});let checks=0;
 const secret="synthetic-delivery-only-32-byte-secret-value",suffix=randomUUID().slice(0,8);
 const {deliveryWorkerCycle}=await import("../marketplace-hub/dist/worker/catalog-delivery-worker.js");
 const {createDeliveryReceiver,postgresDeliveryInbox}=await import("../marketplace-hub/dist/worker/delivery-receiver.js");
 const {deliveryHash,deliverySignature}=await import("../marketplace-hub/dist/worker/delivery-contract.js");
 async function api(path,body,credential=key,operationKey=randomUUID()){
  const response=await fetch(baseUrl+"/v1/"+path,{method:body?"POST":"GET",signal:AbortSignal.timeout(20000),headers:{"x-catalog-hub-key":credential,...(body?{"content-type":"application/json","idempotency-key":operationKey}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json()};
 }
 function expect(reply,status,label){assert.equal(reply.status,status,label+": "+JSON.stringify(reply.data).slice(0,400));checks++;return reply.data;}
 function equal(actual,expected){assert.deepEqual(actual,expected);checks++;}
 const why="Synthetic verified recipient configuration";
 const channel=async(name,environment="TEST")=>expect(await api("channels",{name:"Delivery "+name+" "+suffix,adapter:"OWN_STORE",environment}),201,"create recipient connection");
 const activate=async c=>expect(await api("channels/"+c.id+"/mode",{mode:"ACTIVE",expectedVersion:c.version,confirmed:true}),200,"activate TEST channel");
 const a=await activate(await channel("A")),b=await activate(await channel("B"));
 const product=expect(await api("catalog/products",{card:{sku:"DELIVERY-"+suffix,title:"Synthetic public product",purchasePrice:100,price:200,attributes:{private:{supplier:"must never leave"}}}}),201,"synthetic mapped SKU");
 for(const c of [a,b]){
  expect(await api("channels/"+c.id+"/offers",{productId:product.id,sellerSku:"DELIVERY"+c.id.replaceAll("-","").slice(0,8),price:200,channelBuffer:0,preorderDays:null,expectedVersion:0}),200,"map a channel offer");
  expect(await api("channels/"+c.id+"/mappings",{expectedVersion:c.version,warehouses:[{warehouseId:"wh_pav_01",externalId:"TEST"}]}),200,"map shared warehouse");
 }
 await db.unsafe(readFileSync(new URL("../marketplace-hub/integrations/catalog-delivery-inbox.sql",import.meta.url),"utf8"));
 const handlers=new Map(),seen=[];let loseResponse=false;
 const receiver=createServer(async(req,res)=>{
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
   seen.push({path:req.url,hasCoreKey:Boolean(req.headers["x-catalog-hub-key"]),payload:JSON.parse(body.toString())});
   if(req.url==="/unsigned"){res.writeHead(200,{"content-type":"application/json"});res.end('{"ok":true}');return;}
   const handler=handlers.get(req.url);if(!handler){res.writeHead(404);res.end();return;}
   const response=await handler(new Request("http://127.0.0.1"+req.url,{method:"POST",headers:Object.fromEntries(Object.entries(req.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(","):String(v)])),body}));
   if(loseResponse){loseResponse=false;res.destroy();return;}
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
  }catch{res.destroy();}
 });
 await new Promise(resolve=>receiver.listen(0,"127.0.0.1",resolve));const receiverBase="http://127.0.0.1:"+receiver.address().port;
 const endpointBody=(url,state="ACTIVE",expectedVersion=0)=>({url,secretRef:"CATALOG_DELIVERY_SECRET_TEST",topics:["inventory.changed","catalog.product_changed","channel.offer_changed"],state,expectedVersion,confirmed:true,reason:why});
 const read=async id=>expect(await api("channels/"+id+"/webhook"),200,"recipient status");
 const list=async(id,status="")=>(await read(id)).deliveries.filter(d=>!status||d.status===status);
 const worker=(extra={})=>deliveryWorkerCycle({baseUrl,key,allowedHosts:["127.0.0.1"],allowLoopbackTest:true,secretForRef:()=>secret,maxEvents:10,...extra});
 const due=async()=>{await db`UPDATE public."OutboxDelivery" SET "availableAt"=now()-interval '1 second' WHERE "organizationId"='org_procosmetics' AND "status"='RETRY'`;};
 let webhookA,webhookB;const boundaryChannels=[];
 try{
  handlers.set("/a",createDeliveryReceiver({organizationId:"org_procosmetics",connectionId:a.id,secret,persist:postgresDeliveryInbox(db)}));
  handlers.set("/b",createDeliveryReceiver({organizationId:"org_procosmetics",connectionId:b.id,secret,persist:postgresDeliveryInbox(db)}));
  expect(await api("channels/"+a.id+"/webhook",endpointBody("http://169.254.169.254/metadata")),400,"private non-test target rejected");
  expect(await api("channels/"+a.id+"/webhook",{...endpointBody(receiverBase+"/a"),confirmed:false}),400,"configuration confirmation required");
  expect(await api("channels/"+a.id+"/webhook",endpointBody(receiverBase+"/a"),readOnlyKey),403,"catalog reader cannot configure recipient");
  expect(await api("channels/"+a.id+"/webhook",undefined,keyB),404,"foreign tenant cannot read recipient");
  const prod=await channel("production","PRODUCTION");
  expect(await api("channels/"+prod.id+"/webhook",endpointBody("https://recipient.example/inbox")),409,"production delivery gate retained");
  webhookA=expect(await api("channels/"+a.id+"/webhook",endpointBody(receiverBase+"/a","PAUSED")),200,"configure paused recipient").webhook;
  equal((await worker()).claimed,0);equal(seen.length,0);
  const configureKey=randomUUID(),activeBody=endpointBody(receiverBase+"/a","ACTIVE",webhookA.version);
  webhookA=expect(await api("channels/"+a.id+"/webhook",activeBody,key,configureKey),200,"enable confirmed TEST receiver").webhook;
  equal(expect(await api("channels/"+a.id+"/webhook",activeBody,key,configureKey),200,"config replay").webhook.version,webhookA.version);
  expect(await api("channels/"+a.id+"/webhook",activeBody),409,"stale endpoint version rejected");
  webhookB=expect(await api("channels/"+b.id+"/webhook",endpointBody(receiverBase+"/unsigned")),200,"independent unsigned receiver").webhook;
  const jobs=expect(await api("sync/deliveries/claim",{limit:1}),200,"claim notification for proof validation").items;
  equal(jobs.length,1);const job=jobs[0],time=String(Math.floor(Date.now()/1000));
  const ack={deliveryId:job.id,eventId:job.payload.eventId,connectionId:job.connectionId,payloadHash:deliveryHash(job.payload),status:"ACCEPTED"};
  expect(await api("sync/deliveries/"+job.id+"/complete",{leaseToken:job.leaseToken,ack:{ok:true}}),409,"bare 200 acknowledgement cannot complete");
  expect(await api("sync/deliveries/"+job.id+"/complete",{leaseToken:job.leaseToken,ack,timestamp:time,signature:"v1="+"0".repeat(64)}),401,"forged receipt denied by core");
  expect(await api("sync/deliveries/"+job.id+"/complete",{leaseToken:job.leaseToken,ack,timestamp:time,signature:deliverySignature(secret,"ack",time,ack)},keyB),404,"foreign tenant cannot complete delivery");
  expect(await api("sync/deliveries/"+job.id+"/fail",{leaseToken:job.leaseToken,errorCode:"TEST_RELEASE"}),200,"release proof fixture");await due();
  const outcomes=await Promise.all([worker({maxEvents:1}),worker({maxEvents:1})]);
  assert.ok(outcomes.reduce((sum,r)=>sum+r.delivered,0)>=1);assert.ok(outcomes.reduce((sum,r)=>sum+r.failed,0)>=1);checks++;
  equal((await list(a.id,"DELIVERED")).length,1);equal((await list(b.id,"RETRY")).length,1);
  assert.ok(seen.every(request=>!request.hasCoreKey));assert.ok(seen.every(request=>Object.keys(request.payload.data).join(",")==="refresh"));checks++;
  const [stored]=await db`SELECT count(*)::int AS count FROM public."CatalogDeliveryInbox" WHERE "organizationId"='org_procosmetics' AND "connectionId"=${a.id}`;equal(stored.count,1);
  // Restore receiver B; changing its target cancels obsolete jobs and creates
  // one fresh invalidation, while recipient A keeps its delivered history.
  webhookB=expect(await api("channels/"+b.id+"/webhook",endpointBody(receiverBase+"/b","ACTIVE",webhookB.version)),200,"change recipient destination").webhook;
  equal((await list(b.id,"CANCELED")).length,1);await worker();equal((await list(b.id,"DELIVERED")).length,1);
  const beforeA=(await list(a.id)).length,beforeB=(await list(b.id)).length;
  expect(await api("inventory/movements",{productId:product.id,warehouseId:"wh_pav_01",kind:"RECEIVE",quantity:3,expectedRevision:0,reason:why}),201,"transactional inventory fan-out");
  equal((await list(a.id)).length,beforeA+1);equal((await list(b.id)).length,beforeB+1);await worker();
  // Source operations that do not belong to either channel cannot fan out.
  const unrelated=expect(await api("catalog/products",{card:{sku:"UNMAPPED-"+suffix,title:"Unmapped private product",purchasePrice:150,price:300}}),201,"unmapped product");
  const countA=(await list(a.id)).length;
  expect(await api("inventory/movements",{productId:unrelated.id,warehouseId:"wh_pav_01",kind:"RECEIVE",quantity:1,expectedRevision:0,reason:why}),201,"unmapped stock write");equal((await list(a.id)).length,countA);
  const boundKey=randomUUID()+randomUUID(),hash=createHash("sha256").update(boundKey).digest("hex");
  expect(await api("repricing/policies",{productId:product.id,channel:"STORE",strategy:"UNDERCUT",mode:"DRY_RUN",enabled:false,emergencyStop:true,
   currentOfferPrice:200,minPrice:150,maxPrice:500,shippingCost:0,targetProfit:10,feePercent:0,minMarginPercent:5,
   step:10,adjustment:10,maxChangePercent:5,maxAgeMinutes:60,cooldownMinutes:60}),201,"financial policy remains mandatory for scoped export");
  await db`INSERT INTO public."CatalogApiKey" ("id","name","keyHash","organizationId","scopes") VALUES (${randomUUID()},'Synthetic export reader',${hash},'org_procosmetics',${db.json(["channels:read:"+a.id])})`;
  expect(await api("channels/"+a.id+"/export",undefined,boundKey),200,"receiver reads only its scoped export");
  expect(await api("channels/"+b.id+"/export",undefined,boundKey),403,"bound export key cannot read another receiver");
  expect(await api("channels",undefined,boundKey),403,"bound export key cannot list all channels");
  // Lost receiver response after its SQL COMMIT is recovered as DUPLICATE.
  loseResponse=true;
  expect(await api("inventory/movements",{productId:product.id,warehouseId:"wh_pav_01",kind:"RECEIVE",quantity:1,expectedRevision:1,reason:why}),201,"new invalidation for lost receipt");
  await worker();await due();await worker();
  assert.ok((await list(a.id,"DELIVERED")).some(d=>d.receipt?.status==="DUPLICATE")||(await list(b.id,"DELIVERED")).some(d=>d.receipt?.status==="DUPLICATE"));checks++;
  // Stop a real worker after remote COMMIT, before its completion reaches core.
  expect(await api("inventory/movements",{productId:product.id,warehouseId:"wh_pav_01",kind:"RECEIVE",quantity:1,expectedRevision:2,reason:why}),201,"create crash recovery notification");
  let entered;const completeEntered=new Promise(resolve=>{entered=resolve;});
  const proxy=createServer(async(req,res)=>{
   try{const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);
    if(req.url.endsWith("/complete")){entered(JSON.parse(body.toString()));return;}
    const upstream=await fetch(baseUrl+req.url,{method:req.method,headers:{"x-catalog-hub-key":key,"content-type":"application/json","idempotency-key":req.headers["idempotency-key"]},body});
    res.writeHead(upstream.status,{"content-type":"application/json"});res.end(await upstream.text());
   }catch{res.destroy();}
  });await new Promise(resolve=>proxy.listen(0,"127.0.0.1",resolve));
  const child=spawn(process.execPath,[fileURLToPath(new URL("../marketplace-hub/dist/worker/catalog-delivery-worker.js",import.meta.url)),"--once"],{env:{...process.env,
   CATALOG_DELIVERY_WORKER_ENABLED:"true",CATALOG_HUB_API_URL:"http://127.0.0.1:"+proxy.address().port,CATALOG_HUB_API_KEY:key,
   CATALOG_DELIVERY_ALLOWED_HOSTS:"127.0.0.1",CATALOG_DELIVERY_ALLOW_LOOPBACK_TEST:"true",CATALOG_DELIVERY_SECRET_TEST:secret},stdio:["ignore","pipe","pipe"]});
  let output="";child.stdout.on("data",c=>{output+=c;});child.stderr.on("data",c=>{output+=c;});
  const exited=new Promise(resolve=>child.once("exit",(code,signal)=>resolve({code,signal})));
  let crashedId;
  try{let timer;const body=await Promise.race([completeEntered,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("delivery worker did not reach remote commit")),20000);})]).finally(()=>clearTimeout(timer));
   crashedId=body.ack.deliveryId;child.kill("SIGKILL");equal((await exited).signal,"SIGKILL");assert.ok(!output.includes(key)&&!output.includes(secret));checks++;
  }finally{child.kill("SIGKILL");proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}
  const [pending]=await db`SELECT "status" FROM public."OutboxDelivery" WHERE "id"=${crashedId}`;equal(pending.status,"PROCESSING");
  await db`UPDATE public."OutboxDelivery" SET "leaseUntil"=now()-interval '1 second' WHERE "id"=${crashedId}`;
  await worker();
  const [recovered]=await db`SELECT "status","attempts","receipt" FROM public."OutboxDelivery" WHERE "id"=${crashedId}`;
  equal([recovered.status,recovered.attempts,recovered.receipt.ack.status],["DELIVERED",2,"DUPLICATE"]);
  const [unique]=await db`SELECT count(*)::int AS count FROM public."CatalogDeliveryInbox" WHERE "deliveryId"=${crashedId}`;equal(unique.count,1);
  const [balance]=await db`SELECT "onHand","reserved" FROM public."Inventory" WHERE "productId"=${product.id} AND "warehouseId"='wh_pav_01'`;equal([balance.onHand,balance.reserved],[5,0]);
  const rollbackEvent=randomUUID();
  await assert.rejects(db.begin(async tx=>{
   await tx`INSERT INTO public."OutboxEvent" ("id","organizationId","topic","payload") VALUES (${rollbackEvent},'org_procosmetics','inventory.changed',${tx.json({productId:product.id,warehouseId:"wh_pav_01",purchasePrice:999,actor:"private"})})`;
   const [during]=await tx`SELECT count(*)::int AS count FROM public."OutboxDelivery" WHERE "eventId"=${rollbackEvent}`;equal(during.count,2);
   throw new Error("synthetic rollback");
  }),/synthetic rollback/);
  const [rolledBack]=await db`SELECT count(*)::int AS count FROM public."OutboxDelivery" WHERE "eventId"=${rollbackEvent}`;equal(rolledBack.count,0);
  const exhaustEvent=randomUUID();await db`INSERT INTO public."OutboxEvent" ("id","organizationId","topic","payload") VALUES (${exhaustEvent},'org_procosmetics','channel.refresh_requested',${db.json({connectionId:a.id})})`;
  const [exhausted]=await db`UPDATE public."OutboxDelivery" SET "status"='PROCESSING',"attempts"=8,"leaseToken"='exhausted-test-token',"leaseUntil"=now()-interval '1 second' WHERE "eventId"=${exhaustEvent} RETURNING "id"`;
  await worker();const terminal=(await list(a.id,"DEAD")).find(d=>d.id===exhausted.id);assert.ok(terminal);equal(terminal.lastError,"LEASE_EXHAUSTED");
  expect(await api("sync/deliveries/"+terminal.id+"/retry",{confirmed:false,reason:why,expectedVersion:terminal.version}),409,"DEAD retry confirmation is mandatory");
  expect(await api("sync/deliveries/"+terminal.id+"/retry",{confirmed:true,reason:why,expectedVersion:terminal.version-1}),409,"DEAD retry version is guarded");
  expect(await api("sync/deliveries/"+terminal.id+"/retry",{confirmed:true,reason:why,expectedVersion:terminal.version}),200,"explicit recipient retry");
  await worker();equal((await list(a.id,"DEAD")).length,0);
  // PGlite multiplexes a single backend. This real overlapping-transaction
  // boundary check runs on PostgreSQL in CI, where independent sessions lock.
  if(dbUrl.pathname==="/catalog_test"){
   const boundaryChannel=await activate(await channel("registration-boundary"));boundaryChannels.push(boundaryChannel);
   expect(await api("channels/"+boundaryChannel.id+"/offers",{productId:product.id,sellerSku:"BOUNDARY"+suffix,price:200,expectedVersion:0}),200,"map boundary recipient");
   handlers.set("/c",createDeliveryReceiver({organizationId:"org_procosmetics",connectionId:boundaryChannel.id,secret,persist:postgresDeliveryInbox(db)}));
   let ready,release;const sourceReady=new Promise(resolve=>{ready=resolve;}),continueSource=new Promise(resolve=>{release=resolve;});
   const source=db.begin(async tx=>{
    await tx`UPDATE public."Product" SET "description"='Committed subscription boundary',"updatedAt"=clock_timestamp() WHERE "id"=${product.id}`;
    await tx`INSERT INTO public."OutboxEvent" ("id","organizationId","topic","payload") VALUES (${randomUUID()},'org_procosmetics','catalog.product_changed',${tx.json({productId:product.id})})`;
    ready();await continueSource;
   });
   await sourceReady;let configured=false;
   const configuring=api("channels/"+boundaryChannel.id+"/webhook",endpointBody(receiverBase+"/c")).then(result=>{configured=true;return result;});
   try{await new Promise(resolve=>setTimeout(resolve,80));equal(configured,false);}finally{release();}
   await source;expect(await configuring,200,"registration waits for earlier source commit");
   equal((await list(boundaryChannel.id)).length,1);await worker();equal((await list(boundaryChannel.id,"DELIVERED")).length,1);
   const reverse=await activate(await channel("source-boundary"));boundaryChannels.push(reverse);
   expect(await api("channels/"+reverse.id+"/offers",{productId:product.id,sellerSku:"REVERSE"+suffix,price:200,expectedVersion:0}),200,"map inverse boundary recipient");
   handlers.set("/d",createDeliveryReceiver({organizationId:"org_procosmetics",connectionId:reverse.id,secret,persist:postgresDeliveryInbox(db)}));
   let recipientReady,releaseRecipient;const readyRecipient=new Promise(resolve=>{recipientReady=resolve;}),finishRecipient=new Promise(resolve=>{releaseRecipient=resolve;});
   const registering=db.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtextextended('webhook-config:org_procosmetics',0))`;
    await tx`INSERT INTO public."ChannelWebhook" ("id","organizationId","connectionId","url","secretRef","topics","state","updatedAt")
      VALUES (${randomUUID()},'org_procosmetics',${reverse.id},${receiverBase+"/d"},'CATALOG_DELIVERY_SECRET_TEST','["inventory.changed"]'::jsonb,'ACTIVE',clock_timestamp())`;
    recipientReady();await finishRecipient;
   });
   await readyRecipient;let sourceDone=false;
   const writing=api("inventory/movements",{productId:product.id,warehouseId:"wh_pav_01",kind:"RECEIVE",quantity:1,expectedRevision:3,reason:why}).then(result=>{sourceDone=true;return result;});
   try{await new Promise(resolve=>setTimeout(resolve,80));equal(sourceDone,false);}finally{releaseRecipient();}
   await registering;expect(await writing,201,"source waits for in-progress registration");
   equal((await list(reverse.id)).length,1);await worker();equal((await list(reverse.id,"DELIVERED")).length,1);
  }
  // Ending paused ensures later load tests generate no external delivery work.
  for(const c of [a,b,...boundaryChannels]){const current=(await read(c.id)).webhook;await api("channels/"+c.id+"/webhook",endpointBody(current.url,"PAUSED",current.version));}
  equal((await worker()).claimed,0);
  console.log(`Event delivery: ${checks} API/HTTP/process checks passed; signed PostgreSQL inbox receipts, fan-out and remote-commit crash recovery.`);
  return {checks};
 }finally{receiver.closeAllConnections();await new Promise(resolve=>receiver.close(resolve));await db.end({timeout:1});}
}
