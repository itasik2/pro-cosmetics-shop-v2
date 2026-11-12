// Loopback only. Quota fixtures use synthetic counters; no private payloads.
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {createServer} from "node:http";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";

const canonical=value=>Array.isArray(value)?"["+value.map(canonical).join(",")+"]":value&&typeof value==="object"?"{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}":JSON.stringify(value)??"null";
const hash=value=>createHash("sha256").update(canonical(value)).digest("hex");
export function queueRecoveryFixtures(keyB){
  const keyHash=createHash("sha256").update("queue-quota:"+keyB).digest("hex");
  return `
    INSERT INTO public."Organization" ("id","name","updatedAt") VALUES ('org_queue_quota','Synthetic quota boundaries',now()) ON CONFLICT ("id") DO NOTHING;
    INSERT INTO public."CatalogApiKey" ("id","name","keyHash","organizationId","scopes")
      VALUES ('queue-quota-key','Synthetic quota key','${keyHash}','org_queue_quota','["imports:read","imports:write"]'::jsonb)
      ON CONFLICT ("id") DO UPDATE SET "keyHash"=EXCLUDED."keyHash";
    INSERT INTO public."CatalogImportRun" ("id","organizationId","fileName","fileSha256","manifestHash","profile","expectedRows","uploadedRows","processedRows","failedRows","payloadBytes","state","actor","updatedAt") VALUES
      ('quota-boundary-a','org_queue_quota','synthetic-counter-a.csv','synthetic','synthetic','{}',2,0,0,0,33553920,'UPLOADING','synthetic',now()),
      ('quota-boundary-b','org_queue_quota','synthetic-counter-b.csv','synthetic','synthetic','{}',1,0,0,0,33553920,'UPLOADING','synthetic',now()),
      ('quota-boundary-retry','org_queue_quota','synthetic-counter-retry.csv','synthetic','synthetic','{}',1,1,1,1,2048,'PARTIAL','synthetic',now())
      ON CONFLICT ("id") DO UPDATE SET "state"=EXCLUDED."state","version"=1,"payloadBytes"=EXCLUDED."payloadBytes","uploadedRows"=EXCLUDED."uploadedRows","processedRows"=EXCLUDED."processedRows","failedRows"=EXCLUDED."failedRows";
    INSERT INTO public."CatalogImportRow" ("id","organizationId","runId","rowNumber","sku","action","payload","payloadHash","state","attempts","updatedAt")
      VALUES ('quota-retry-row','org_queue_quota','quota-boundary-retry',1,'QUOTA-RETRY','CREATE','{}','synthetic','ERROR',1,now())
      ON CONFLICT ("id") DO UPDATE SET "state"='ERROR',"attempts"=1;
    INSERT INTO public."OutboxEvent" ("id","organizationId","topic","payload","status","attempts","availableAt","leaseToken","leaseUntil","createdAt") VALUES
      ('queue-expired-lease','org_procosmetics','synthetic.recovery','{}','PROCESSING',1,'2000-01-01','expired-worker-token',now()-interval '1 minute','2000-01-01'),
      ('queue-exhausted-lease','org_procosmetics','synthetic.recovery','{}','PROCESSING',8,'2000-01-01','exhausted-worker-token',now()-interval '1 minute','2000-01-01'),
      ('queue-live-lease','org_procosmetics','synthetic.recovery','{}','PROCESSING',1,'2000-01-01','live-worker-token',now()+interval '1 day','2000-01-01')
      ON CONFLICT ("id") DO UPDATE SET "status"=EXCLUDED."status","attempts"=EXCLUDED."attempts","availableAt"=EXCLUDED."availableAt","leaseToken"=EXCLUDED."leaseToken","leaseUntil"=EXCLUDED."leaseUntil","lastError"=NULL,"deliveredAt"=NULL;
  `;
}

export async function runQueueRecoveryChecks({baseUrl="http://127.0.0.1:8000",key,keyB,readOnlyKey}){
  assert.equal(new URL(baseUrl).hostname,"127.0.0.1");assert.equal(new URL(baseUrl).protocol,"http:");
  let checks=0;const suffix=randomUUID().slice(0,8),quotaKey="queue-quota:"+keyB;
  async function api(path,body,credential=key,idempotencyKey=randomUUID()){
    const response=await fetch(baseUrl+"/v1/"+path,{method:body?"POST":"GET",signal:AbortSignal.timeout(30000),
      headers:{"x-catalog-hub-key":credential,...(body?{"content-type":"application/json","idempotency-key":idempotencyKey}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json()};
  }
  function expect(reply,status,label){assert.equal(reply.status,status,label+": "+JSON.stringify(reply.data).slice(0,400));checks++;return reply.data;}
  function equal(actual,expected){assert.deepEqual(actual,expected);checks++;}
  const metadata=expectedRows=>({fileName:"synthetic-recovery-"+randomUUID()+".csv",fileSha256:"f".repeat(64),manifestHash:"a".repeat(64),profile:{},expectedRows});
  async function cancel(run,credential=key){return expect(await api("imports/"+run.id+"/cancel",{confirmed:true,expectedVersion:run.version},credential),200,"free reviewed import capacity");}
  const row=(number,extra={})=>({rowNumber:number,sku:"RECOVERY-"+suffix+"-"+number,action:"CREATE",expectedUpdatedAt:null,
    payload:{card:{sku:"RECOVERY-"+suffix+"-"+number,title:"Synthetic recovery product "+number,purchasePrice:100,price:200,...extra}}});
  async function enqueue(rows){
    const run=expect(await api("imports",{...metadata(rows.length),manifestHash:hash(rows.map(r=>({rowNumber:r.rowNumber,payloadHash:hash(r)})))}),201,"create reviewed recovery task");
    expect(await api("imports/"+run.id+"/rows",{rows}),200,"upload immutable recovery rows");
    return expect(await api("imports/"+run.id+"/seal",{confirmed:true}),200,"seal reviewed recovery manifest");
  }
  const status=expect(await api("imports/status"),200,"import queue metrics");equal(status.usage.activeRuns,0);
  expect(await api("imports/status",undefined,readOnlyKey),403,"queue metrics require import scope");
  expect(await api("sync/status",undefined,quotaKey),403,"import key cannot inspect delivery queue");
  const badRun=await enqueue([row(999,{stock:1})]);
  const failed=expect(await api("imports/"+badRun.id+"/process",{limit:1}),200,"prepare failed task for retry quota");equal(failed.state,"PARTIAL");
  const requests=[metadata(10000),metadata(10000),metadata(10000)],keys=requests.map(()=>randomUUID());
  const concurrent=await Promise.all(requests.map((body,i)=>api("imports",body,key,keys[i])));
  equal(concurrent.map(r=>r.status).sort(),[201,201,429]);
  const active=concurrent.flatMap((r,i)=>r.status===201?[{run:r.data,body:requests[i],key:keys[i]}]:[]);
  equal(expect(await api("imports/status"),200,"row quota after concurrent enqueue").usage.reservedRows,20000);
  equal(expect(await api("imports/"+failed.id+"/retry",{confirmed:true,expectedVersion:failed.version}),429,"retry cannot bypass the row quota").error,"import_row_queue_limit");
  equal(expect(await api("imports",active[0].body,key,active[0].key),201,"enqueue replay does not consume more capacity").id,active[0].run.id);
  const other=expect(await api("imports",metadata(10000),keyB),201,"quotas are tenant scoped");await cancel(other,keyB);
  for(const item of active)await cancel(item.run);
  await cancel(expect(await api("imports/"+failed.id+"/retry",{confirmed:true,expectedVersion:failed.version}),200,"failed retry leaves version available after capacity is freed"));
  const slots=await Promise.all(Array.from({length:11},()=>api("imports",metadata(1))));
  equal(slots.filter(r=>r.status===201).length,10);equal(slots.filter(r=>r.status===429).length,1);
  for(const item of slots.filter(r=>r.status===201))await cancel(item.data);

  const large=row(1,{description:"Я".repeat(1600)}),payloadKey=randomUUID();
  const quotaBefore=expect(await api("imports/status",undefined,quotaKey),200,"synthetic payload boundary");
  equal(expect(await api("imports/quota-boundary-a/rows",{rows:[large]},quotaKey),413,"per-run bytes cannot exceed 32 MiB").error,"import_run_payload_limit");
  const bytesRun=expect(await api("imports",metadata(1),quotaKey),201,"third byte boundary task");
  expect(await api("imports/"+bytesRun.id+"/rows",{rows:[row(1,{description:"Я".repeat(31000)})]},quotaKey),400,"row payload limit measures UTF-8 bytes");
  equal(expect(await api("imports/"+bytesRun.id+"/rows",{rows:[large]},quotaKey,payloadKey),429,"tenant payload cap cannot be bypassed by another run").error,"import_payload_queue_limit");
  equal(expect(await api("imports/"+bytesRun.id,undefined,quotaKey),200,"failed chunk rollback").uploadedRows,0);
  equal(expect(await api("imports/status",undefined,quotaKey),200,"failed chunks preserve accounting").usage.payloadBytes,quotaBefore.usage.payloadBytes);
  equal(expect(await api("imports/quota-boundary-retry/retry",{confirmed:true,expectedVersion:1},quotaKey),429,"retry reserves payload quota too").error,"import_payload_queue_limit");
  await cancel(expect(await api("imports/quota-boundary-b",undefined,quotaKey),200,"read boundary task"),quotaKey);
  const uploaded=expect(await api("imports/"+bytesRun.id+"/rows",{rows:[large]},quotaKey,payloadKey),200,"same failed chunk can succeed after capacity is freed");
  assert.ok(uploaded.payloadBytes>Buffer.byteLength(JSON.stringify(large.payload)));checks++;
  equal(expect(await api("imports/"+bytesRun.id+"/rows",{rows:[large]},quotaKey,payloadKey),200,"chunk replay preserves byte total").payloadBytes,uploaded.payloadBytes);
  const retried=expect(await api("imports/quota-boundary-retry/retry",{confirmed:true,expectedVersion:1},quotaKey),200,"retry after capacity becomes available");
  await cancel(retried,quotaKey);await cancel(uploaded,quotaKey);
  await cancel(expect(await api("imports/quota-boundary-a",undefined,quotaKey),200,"remaining quota boundary"),quotaKey);
  equal(expect(await api("imports/status",undefined,quotaKey),200,"all quota fixtures release capacity").usage.activeRuns,0);

  // Kill a real worker AFTER the API commits a batch, BEFORE the worker receives
  // its response. A fresh process must continue from the persisted checkpoints.
  const recovery=await enqueue(Array.from({length:24},(_,i)=>row(i+1)));
  let committed;const checkpoint=new Promise(resolve=>{committed=resolve;});
  const proxy=createServer(async(req,res)=>{
    try{
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=Buffer.concat(chunks);
      const upstream=await fetch(baseUrl+req.url,{method:req.method,headers:{"x-catalog-hub-key":key,
        ...(body.length?{"content-type":"application/json","idempotency-key":req.headers["idempotency-key"]}:{})},...(body.length?{body}:{})});
      const text=await upstream.text();
      if(req.url.endsWith("/process")){committed({status:upstream.status,data:JSON.parse(text)});return;}
      res.writeHead(upstream.status,{"content-type":"application/json"});res.end(text);
    }catch{res.destroy();}
  });
  await new Promise(resolve=>proxy.listen(0,"127.0.0.1",resolve));
  const workerFile=fileURLToPath(new URL("../marketplace-hub/dist/worker/catalog-import-worker.js",import.meta.url));
  const start=(url,once=false)=>{
    const child=spawn(process.execPath,[workerFile,...(once?["--once"]:[])],{env:{...process.env,CATALOG_IMPORT_WORKER_ENABLED:"true",CATALOG_IMPORT_WORKER_BATCH_ROWS:"10",CATALOG_HUB_API_URL:url,CATALOG_HUB_API_KEY:key},stdio:["ignore","pipe","pipe"]});
    let output="";child.stdout.on("data",chunk=>{output+=chunk;});child.stderr.on("data",chunk=>{output+=chunk;});
    const done=new Promise(resolve=>child.once("exit",(code,signal)=>resolve({code,signal,output})));
    return {child,done};
  };
  const crashed=start("http://127.0.0.1:"+proxy.address().port);
  try{
    let timer;const result=await Promise.race([checkpoint,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("worker did not reach committed checkpoint")),20000);})]).finally(()=>clearTimeout(timer));
    equal(result.status,200);equal(result.data.processedRows,10);
    crashed.child.kill("SIGKILL");const exit=await crashed.done;equal(exit.signal,"SIGKILL");assert.ok(!exit.output.includes(key));checks++;
  }finally{crashed.child.kill("SIGKILL");proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}
  const afterKill=expect(await api("imports/"+recovery.id),200,"checkpoint survives worker process loss");equal(afterKill.processedRows,10);
  for(let i=0;i<2;i++){
    const restarted=start(baseUrl,true),timer=setTimeout(()=>restarted.child.kill("SIGKILL"),20000);
    const exit=await restarted.done;clearTimeout(timer);equal(exit.code,0);assert.ok(!exit.output.includes(key));checks++;
  }
  const done=expect(await api("imports/"+recovery.id),200,"fresh workers finish the durable task");equal([done.state,done.processedRows,done.failedRows],["SUCCEEDED",24,0]);
  const report=expect(await api("imports/"+recovery.id+"/rows"),200,"recovered row checkpoint report");equal(report.items.length,24);assert.ok(report.items.every(r=>r.state==="APPLIED"&&r.attempts===1));checks++;
  const products=expect(await api("catalog/products?q=RECOVERY-"+suffix+"-&limit=100"),200,"one product per recovered source row");equal(products.pagination.total,24);assert.ok(products.items.every(p=>p.totals.stock===0&&p.totals.reserved===0));checks++;
  equal(expect(await api("imports/"+recovery.id+"/process",{limit:100}),200,"completed recovery cannot apply rows twice").batchProcessed,0);
  const idle=start(baseUrl),stopTimer=setTimeout(()=>idle.child.kill("SIGKILL"),10000);
  try{
    await Promise.race([new Promise(resolve=>idle.child.stdout.once("data",resolve)),idle.done.then(()=>{throw new Error("idle worker exited before heartbeat");})]);
    idle.child.kill("SIGTERM");equal((await idle.done).code,0);
  }finally{clearTimeout(stopTimer);idle.child.kill("SIGKILL");}

  const sync=expect(await api("sync/status"),200,"delivery queue metrics");equal(sync.usage.expiredLeases,2);
  expect(await api("sync/outbox/queue-live-lease/ack",{leaseToken:"live-worker-token"},keyB),404,"lease ownership is tenant scoped");
  const claims=await Promise.all([api("sync/outbox/claim",{limit:100}),api("sync/outbox/claim",{limit:100})]);
  const claimed=claims.flatMap(reply=>expect(reply,200,"concurrent lease capacity").events);
  equal(claimed.length,99);equal(new Set(claimed.map(event=>event.id)).size,99);
  equal(expect(await api("sync/status"),200,"claim quota is enforced across workers").usage.inFlight,100);
  const reclaimed=claimed.find(event=>event.id==="queue-expired-lease");assert.ok(reclaimed);equal(reclaimed.attempts,2);
  expect(await api("sync/outbox/queue-expired-lease/ack",{leaseToken:"expired-worker-token"}),409,"old worker cannot acknowledge a reclaimed lease");
  const dead=expect(await api("sync/outbox?status=DEAD&limit=100"),200,"expired eighth lease becomes dead letter").items.find(event=>event.id==="queue-exhausted-lease");equal(dead.lastError,"LEASE_EXHAUSTED");
  expect(await api("sync/outbox/queue-exhausted-lease/retry",{confirmed:false}),409,"dead-letter retry requires confirmation");
  equal(expect(await api("sync/outbox/queue-exhausted-lease/retry",{confirmed:true}),200,"explicit retry restores eligibility").status,"RETRY");
  const page=expect(await api("sync/outbox?limit=1"),200,"outbox bounded page");assert.ok(page.nextCursor);checks++;
  const next=expect(await api("sync/outbox?limit=1&cursor="+page.nextCursor),200,"outbox cursor");assert.notEqual(page.items[0].id,next.items[0].id);checks++;
  expect(await api("sync/outbox?status=UNKNOWN"),400,"outbox filter validated");
  // All acknowledgements below concern synthetic events in this isolated suite.
  for(const event of claimed)expect(await api("sync/outbox/"+event.id+"/ack",{leaseToken:event.leaseToken}),200,"finish synthetic lease");
  expect(await api("sync/outbox/queue-live-lease/ack",{leaseToken:"live-worker-token"}),200,"finish synthetic initial lease");
  equal(expect(await api("sync/status"),200,"lease capacity is released").usage.inFlight,0);
  console.log(`Queue recovery: ${checks} API/process checks passed; worker killed after commit and resumed without duplicate rows.`);
  return {checks};
}
