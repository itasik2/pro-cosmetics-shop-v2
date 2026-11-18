#!/usr/bin/env node
// Synthetic imports only; never runs against a remote database or API.
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
const canonical=value=>Array.isArray(value)?"["+value.map(canonical).join(",")+"]":value&&typeof value==="object"?"{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}":JSON.stringify(value)??"null";
const hash=value=>createHash("sha256").update(canonical(value)).digest("hex");
export async function runQueuedImportChecks({baseUrl="http://127.0.0.1:8000",key,keyB,readOnlyKey,scaleRows=40,workerCycle}){
  assert.equal(new URL(baseUrl).hostname,"127.0.0.1");assert.equal(new URL(baseUrl).protocol,"http:");
  const prefix="QUEUE-"+randomUUID().slice(0,8)+"-";let checks=0;
  async function api(path,body,credential=key,operationKey=randomUUID()){
    const response=await fetch(baseUrl+path,{method:body?"POST":"GET",signal:AbortSignal.timeout(45000),headers:{"x-catalog-hub-key":credential,
      ...(body?{"content-type":"application/json","idempotency-key":operationKey}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json()};
  }
  function expect(reply,status,label){assert.equal(reply.status,status,label+": "+JSON.stringify(reply.data).slice(0,500));checks++;return reply.data;}
  const row=(number,extra={})=>({rowNumber:number,sku:prefix+number,action:"CREATE",expectedUpdatedAt:null,
    payload:{card:{sku:prefix+number,title:"Synthetic queued product "+number,purchasePrice:100,price:200,...extra}}});
  async function create(rows,manifestHash,metadata={}){
    const manifest=manifestHash||hash(rows.map(r=>({rowNumber:r.rowNumber,payloadHash:hash(r)})));
    return expect(await api("/v1/imports",{fileName:"synthetic-queue.csv",fileSha256:"d".repeat(64),manifestHash:manifest,
      supplierId:null,sourceDate:"2026-10-28",profile:{mapping:{sku:"sku",title:"title"}},expectedRows:rows.length,...metadata}),201,"create durable import run");
  }
  if(readOnlyKey)expect(await api("/v1/imports",{fileName:"forbidden.csv"},readOnlyKey),403,"catalog reader cannot enqueue imports");
  const rows=Array.from({length:scaleRows},(_,i)=>row(i+1));
  const run=await create(rows),split=Math.min(100,Math.max(1,Math.floor(rows.length/2))),firstKey=randomUUID();
  if(keyB)expect(await api("/v1/imports/"+run.id,undefined,keyB),404,"other tenant cannot see a run");
  expect(await api("/v1/imports/"+run.id+"/rows",{rows:rows.slice(0,split)},key,firstKey),200,"upload first immutable chunk");
  assert.equal(expect(await api("/v1/imports/"+run.id+"/rows",{rows:rows.slice(0,split)},key,firstKey),200,"chunk replay").uploadedRows,split);checks++;
  if(split<rows.length)expect(await api("/v1/imports/"+run.id+"/seal",{confirmed:true}),409,"incomplete run cannot start");
  assert.equal(expect(await api("/v1/imports/"+run.id+"/process",{limit:20}),200,"unconfirmed run is read-only").batchProcessed,0);checks++;
  expect(await api("/v1/catalog/by-sku/"+rows[0].sku),404,"uploading source does not create stock or products");
  for(let offset=split;offset<rows.length;offset+=100)expect(await api("/v1/imports/"+run.id+"/rows",{rows:rows.slice(offset,offset+100)}),200,"upload bounded chunk");
  const sealKey=randomUUID();expect(await api("/v1/imports/"+run.id+"/seal",{confirmed:true},key,sealKey),200,"confirm exact manifest");
  expect(await api("/v1/imports/"+run.id+"/seal",{confirmed:true},key,sealKey),200,"confirmation replay");
  if(workerCycle){
    const results=await workerCycle({baseUrl,key,batchLimit:Math.min(25,scaleRows)});
    assert.ok(results.some(result=>result.id===run.id&&result.processedRows>0),"independent Node worker advances the approved run");checks++;
  }
  let progress=run,cycle=0;
  const started=Date.now();
  do{
    // Parallel processors serialize checkpoints without duplicating a row.
    const outcomes=await Promise.all([api("/v1/imports/"+run.id+"/process",{limit:100}),api("/v1/imports/"+run.id+"/process",{limit:100})]);
    outcomes.forEach(r=>expect(r,200,"concurrent durable processor"));
    progress=expect(await api("/v1/imports/"+run.id),200,"durable progress after batch");
    if(scaleRows>=1000&&cycle++%5===0)console.log(`Synthetic import ${progress.processedRows}/${scaleRows}`);
    assert.ok(Date.now()-started<600000,"large import exceeds test deadline");
  }while(progress.state==="QUEUED"||progress.state==="RUNNING");
  assert.equal(progress.state,"SUCCEEDED","large run "+JSON.stringify(progress));assert.equal(progress.processedRows,scaleRows);assert.equal(progress.failedRows,0);checks++;
  assert.equal(expect(await api("/v1/imports/"+run.id+"/process",{limit:100}),200,"completed process replay").batchProcessed,0);checks++;
  const catalog=expect(await api("/v1/catalog/products?q="+prefix+"&limit=100"),200,"all imported SKUs have distinct identities");
  assert.equal(catalog.pagination.total,scaleRows);assert.ok(catalog.items.every(p=>p.totals.stock===0&&p.totals.reserved===0));checks++;
  const report=expect(await api("/v1/imports/"+run.id+"/rows?limit=20"),200,"row report is paginated");
  assert.equal(report.items.length,Math.min(20,scaleRows));assert.ok(report.items.every(r=>r.state==="APPLIED"&&r.attempts===1));checks++;
  async function submitRows(input,metadata={}){
    const job=await create(input,undefined,metadata);
    expect(await api("/v1/imports/"+job.id+"/rows",{rows:input}),200,"upload reviewed actions");
    expect(await api("/v1/imports/"+job.id+"/seal",{confirmed:true}),200,"seal reviewed actions");
    return expect(await api("/v1/imports/"+job.id+"/process",{limit:20}),200,"checkpoint reviewed actions");
  }
  const original=expect(await api("/v1/catalog/by-sku/"+rows[0].sku),200,"read target for staged update");
  const staged=await submitRows([{rowNumber:1,sku:original.sku,action:"STAGE",expectedUpdatedAt:original.updatedAt,
    payload:{productId:original.id,sourceType:"IMPORT",sourceRef:"supplierfile:"+randomUUID().replaceAll("-","")+":1",proposed:{price:180}}}]);
  assert.equal(staged.state,"SUCCEEDED","staging run "+JSON.stringify(staged)+" report "+JSON.stringify((await api("/v1/imports/"+staged.id+"/rows")).data));checks++;
  const stagedRows=expect(await api("/v1/imports/"+staged.id+"/rows"),200,"staging row checkpoint");
  assert.equal(stagedRows.items[0].state,"STAGED");checks++;
  expect(await api("/v1/staging/changesets/"+stagedRows.items[0].result.id),200,"queued change is available for approval");
  assert.equal(expect(await api("/v1/catalog/products/"+original.id),200,"staging leaves reviewed prices unchanged").price,200);checks++;
  expect(await api("/v1/catalog/manual-save",{productId:original.id,expectedUpdatedAt:original.updatedAt,proposed:{description:"Later operator edit"}}),200,"operator edits between preview and queued apply");
  const stale=await submitRows([{rowNumber:1,sku:original.sku,action:"STAGE",expectedUpdatedAt:original.updatedAt,
    payload:{productId:original.id,sourceType:"IMPORT",sourceRef:"supplierfile:"+randomUUID().replaceAll("-","")+":1",proposed:{price:170}}}]);
  assert.equal(stale.state,"PARTIAL");assert.equal(expect(await api("/v1/imports/"+stale.id+"/rows"),200,"stale row report").items[0].errorCode,"import_row_stale");checks++;
  const supplier=expect(await api("/v1/price-import/suppliers",{name:"Synthetic queue supplier "+prefix,code:prefix.toLowerCase()+"supplier"}),201,"supplier for automatic increase");
  const priced=expect(await api("/v1/catalog/products",{supplierId:supplier.id,supplierSku:prefix+"AUTO",card:{sku:prefix+"AUTO",title:"Synthetic cost update",brand:"Test",purchasePrice:100,price:200,
    attributes:{supplierImport:{supplierId:supplier.id,sourceDate:"2026-10-01"}}}}),201,"linked product with dated provenance");
  const automatic=await submitRows([{rowNumber:1,sku:priced.sku,action:"AUTO_INCREASE",expectedUpdatedAt:priced.updatedAt,payload:{productId:priced.id,sku:priced.sku,
    title:priced.title,brand:priced.brand,supplierId:supplier.id,sourceDate:"2026-10-28",fileName:"synthetic-queue.csv",fileSha256:"d".repeat(64),purchasePrice:150,price:250}}],{supplierId:supplier.id});
  assert.equal(automatic.state,"SUCCEEDED","automatic run "+JSON.stringify(automatic)+" report "+JSON.stringify((await api("/v1/imports/"+automatic.id+"/rows")).data));checks++;
  const updated=expect(await api("/v1/catalog/products/"+priced.id),200,"read queued price result");
  assert.equal(updated.purchasePrice,150);assert.equal(updated.price,250);assert.equal(updated.totals.stock,0);checks++;

  const historyPath = "/v1/catalog/products/" + priced.id + "/revisions";
  const priceRevision = expect(await api(historyPath), 200, "automatic import in card history").items[0];
  const pricePreview = expect(await api(historyPath + "/" + priceRevision.id), 200, "price rollback preview");
  assert.equal(pricePreview.supplierChanged, true);
  assert.equal(pricePreview.blocked, null);
  expect(await api(historyPath + "/" + priceRevision.id + "/rollback", {
    confirmed:true, expectedVersion:pricePreview.expectedVersion, reason:"Restore synthetic supplier price",
  }), 200, "restore price, supplier link and source together");
  const restored = expect(await api("/v1/catalog/products/" + priced.id), 200, "restored supplier price");
  assert.equal(restored.purchasePrice,100);
  assert.equal(restored.price,200);
  assert.equal(restored.attributes.supplierImport.sourceDate,"2026-10-01");

  const unlinked = expect(await api("/v1/catalog/products/" + original.id), 200, "read unlinked product");
  const linkRun = await submitRows([{ rowNumber: 1, sku: unlinked.sku, action: "STAGE", expectedUpdatedAt: unlinked.updatedAt,
    payload: { productId: unlinked.id, sourceType: "IMPORT", sourceRef: "supplierfile:" + randomUUID().replaceAll("-", "") + ":1",
      proposed: { attributes: { supplierImport: { supplierId: supplier.id, supplierSku: unlinked.sku, sourceDate: "2026-10-28" } } } } }], { supplierId: supplier.id });
  const linkRows = expect(await api("/v1/imports/" + linkRun.id + "/rows"), 200, "report staged supplier link");
  const linkSet = "/v1/staging/changesets/" + linkRows.items[0].result.id;
  expect(await api(linkSet + "/approve", { approvedFields: ["attributes"] }), 200, "approve new supplier link");
  const appliedLink = expect(await api(linkSet + "/apply", {}), 200, "apply new supplier link");
  const linkHistory = "/v1/catalog/products/" + unlinked.id + "/revisions/";
  const links = async () => expect(await api("/v1/catalog/snapshot"), 200, "read supplier links")
    .items.find(item => item.id === unlinked.id).supplierLinks;
  const undo = async revisionId => {
    const detail = expect(await api(linkHistory + revisionId), 200, "preview supplier link restoration");
    return expect(await api(linkHistory + revisionId + "/rollback", {
      confirmed: true, expectedVersion: detail.expectedVersion, reason: "Restore synthetic supplier link state",
    }), 200, "restore supplier link state");
  };
  assert.deepEqual(await links(), [{ supplierId: supplier.id, supplierSku: unlinked.sku }]);
  const removedLink = await undo(appliedLink.revisionId);
  assert.deepEqual(await links(), []);
  await undo(removedLink.revisionId);
  assert.deepEqual(await links(), [{ supplierId: supplier.id, supplierSku: unlinked.sku }]);

  // An unsafe row rolls back before the checkpoint; safe rows are not replayed.
  const bad=row(10001,{stock:50}),partial=await create([bad]);
  expect(await api("/v1/imports/"+partial.id+"/rows",{rows:[bad]}),200,"upload rejected stock operation");
  expect(await api("/v1/imports/"+partial.id+"/seal",{confirmed:true}),200,"confirm row requiring validation");
  let failed=expect(await api("/v1/imports/"+partial.id+"/process",{limit:20}),200,"per-row failure is reported");
  assert.equal(failed.state,"PARTIAL");assert.equal(failed.failedRows,1);checks++;
  expect(await api("/v1/catalog/by-sku/"+bad.sku),404,"failed create leaves no partial product");
  for(let attempt=1;attempt<3;attempt++){
    expect(await api("/v1/imports/"+partial.id+"/retry",{expectedVersion:failed.version,confirmed:true}),200,"explicit bounded retry");
    failed=expect(await api("/v1/imports/"+partial.id+"/process",{limit:20}),200,"retried row still validates");
  }
  expect(await api("/v1/imports/"+partial.id+"/retry",{expectedVersion:failed.version,confirmed:true}),409,"retry limit enforced");
  const reportError=expect(await api("/v1/imports/"+partial.id+"/rows"),200,"error report persists attempts");assert.equal(reportError.items[0].attempts,3);checks++;
  const canceled=await create([row(10000)]);
  expect(await api("/v1/imports/"+canceled.id+"/cancel",{expectedVersion:canceled.version,confirmed:true}),200,"cancel before work");
  assert.equal(expect(await api("/v1/imports/"+canceled.id+"/process",{limit:20}),200,"canceled work cannot run").batchProcessed,0);checks++;
  console.log(`Queued imports: ${checks} checks passed; ${scaleRows} rows applied once with zero physical stock in ${Date.now()-started} ms.`);
  return {checks};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {key}=JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),".test-credentials.json"),"utf8"));
  const option=process.argv.find(a=>a.startsWith("--scale="));
  await runQueuedImportChecks({key,scaleRows:option?Number(option.slice(8)):40});
}
