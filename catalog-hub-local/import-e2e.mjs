#!/usr/bin/env node
// Only run this against the isolated localhost Docker catalog backend.
import assert from "node:assert/strict";
import {randomBytes,timingSafeEqual} from "node:crypto";
import {readFileSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const web=join(root,"catalog-hub-web");
function env(path){
 return Object.fromEntries(readFileSync(path,"utf8").split(/\r?\n/).filter(x=>x&&!x.startsWith("#"))
  .map(x=>[x.slice(0,x.indexOf("=")),x.slice(x.indexOf("=")+1)]));
}
const cfg=env(join(web,".env.local"));
const cred=JSON.parse(readFileSync(join(root,"catalog-hub-local/.test-credentials.json"),"utf8"));
const api="http://127.0.0.1:8000",ui="http://127.0.0.1:3001";
assert.equal(cfg.CATALOG_HUB_API_URL,api,"Refusing non-local database");
assert.equal(cfg.CATALOG_HUB_LOCAL_MODE,"true");
assert.equal(cfg.CATALOG_HUB_LOCAL_WRITE_ENABLED,"true");
const a=Buffer.from(cfg.CATALOG_HUB_API_KEY||""),b=Buffer.from(cred.key||"");
assert.ok(a.length>0&&a.length===b.length&&timingSafeEqual(a,b),
 "Refusing: localhost API key mismatch");
assert.ok(cfg.CATALOG_HUB_UI_PASSWORD?.length>0&&cfg.CATALOG_HUB_UI_SESSION_TOKEN?.length>=24);
async function request(url,{method="GET",headers={},body,expected=200}={}){
 const r=await fetch(url,{method,headers,body,redirect:"manual",signal:AbortSignal.timeout(30000)});
 const data=await r.json().catch(()=>null);
 assert.equal(r.status,expected,"Unexpected HTTP "+r.status+": "+JSON.stringify(data));
 return {response:r,data};
}
async function waitForUi(){
 for(let i=0;i<60;i++){
  try{
   const response=await fetch(ui+"/api/health",{signal:AbortSignal.timeout(5000)});
   if(response.status===200)return;
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 throw new Error("Start npm run local:dev before importer e2e");
}
function multipart(csv,action,extras={}){
 const form=new FormData();
 form.set("file",new File([csv],"integration-import.csv",{type:"text/csv"}));
 form.set("action",action);
 for(const [key,value] of Object.entries(extras))form.set(key,value);
 return form;
}
function historyMultipart(historyId,action,extras={}){
 const form=new FormData();form.set("historyId",historyId);form.set("action",action);
 for(const [key,value] of Object.entries(extras))form.set(key,value);
 return form;
}
await waitForUi();
const session=await request(ui+"/api/session",{
 method:"POST",headers:{"content-type":"application/json"},
 body:JSON.stringify({password:cfg.CATALOG_HUB_UI_PASSWORD})
});
const cookie=session.response.headers.get("set-cookie")?.split(";")[0]||"";
assert.match(cookie,/^catalog_hub_session=/);
const httpHeaders={origin:ui,cookie};
const apiHeaders={"x-catalog-hub-key":cred.key};
async function snapshot(){
 return (await request(api+"/v1/catalog/snapshot?organizationId=org_procosmetics",
 {headers:apiHeaders})).data;
}
const initial=await snapshot();
const old=initial.items.find(p=>p.sku==="TEST-LOCAL-001");
assert.ok(old,"Test product missing: run testdb:setup");
const targetPrice=old.price===4900?5000:4900;
const sku="TEST-IMPORTED-"+randomBytes(5).toString("hex").toUpperCase();
const csv=[
 "Артикул;Наименование;Бренд;Закупочная цена;Розничная цена;Количество",
 "TEST-LOCAL-001;"+old.title+";Demo;3000;"+targetPrice+";12",
 sku+";Интеграционный тестовый товар;Demo;1000;1500;100",
].join("\n");
const preview=(await request(ui+"/api/import",{
 method:"POST",headers:httpHeaders,body:multipart(csv,"preview")
})).data;
assert.equal(preview.canApply,true);
assert.match(preview.historyId,/^[a-f0-9-]{36}$/);
assert.equal(preview.review.length,2);
assert.equal(preview.universalCatalog.schema,"catalog-hub/supplier-draft");
assert.equal(preview.universalCatalog.products[1].prices.purchase,1000);
assert.equal(preview.universalCatalog.products[1].inventory.ownQuantity,null);
assert.ok(preview.universalCatalog.products[1].enrichment.missingFields.includes("images"));
const matched=preview.review.find(p=>p.sku==="TEST-LOCAL-001");
const newRow=preview.review.find(p=>p.sku===sku);
assert.equal(matched?.status,"UPDATE",JSON.stringify(matched));
assert.equal(newRow?.status,"CREATE",JSON.stringify(newRow));
assert.equal(matched.changes.find(c=>c.field==="price")?.after,targetPrice);
const reopened=(await request(ui+"/api/import",{
 method:"POST",headers:httpHeaders,body:historyMultipart(preview.historyId,"preview")
})).data;
assert.equal(reopened.review.length,2);
assert.equal(reopened.fingerprint,preview.fingerprint,"History must recompute the current review");
const selected=JSON.stringify([matched.index,newRow.index]);
await request(ui+"/api/import",{
 method:"POST",headers:httpHeaders,
 body:multipart(csv,"apply",{confirmed:"yes",fingerprint:"0".repeat(64),selected}),
 expected:409
});
const applied=(await request(ui+"/api/import",{
 method:"POST",headers:httpHeaders,
 body:historyMultipart(preview.historyId,"apply",{confirmed:"yes",fingerprint:reopened.fingerprint,selected})
})).data;
assert.equal(applied.partial,false,JSON.stringify(applied));
assert.deepEqual(applied.results.map(x=>x.status),["STAGED","CREATED"],JSON.stringify(applied));
const after=await snapshot();
const created=after.items.find(p=>p.sku===sku);
assert.ok(created,"New test product not created");
assert.equal(created.price,1500);
assert.equal(created.stock,0,"Supplier stock must not be copied");
assert.equal(created.attributes.supplierImport.fileName,"integration-import.csv");
assert.equal(after.items.find(p=>p.sku==="TEST-LOCAL-001")?.price,old.price,
  "Staged change must not edit product immediately");
const history=(await request(ui+"/api/import/local-profiles",{headers:{cookie}})).data.history;
assert.ok(history.some(h=>h.id===preview.historyId&&h.hasSnapshot));
assert.ok(history.some(h=>h.action==="APPLY"&&h.hasSnapshot));
const updated=(await request(ui+"/api/import",{
 method:"POST",headers:httpHeaders,body:historyMultipart(preview.historyId,"preview")
})).data;
assert.notEqual(updated.review.find(p=>p.sku===sku)?.status,"CREATE",
 "Reopened history must compare with the latest catalog");
const deleted=(await request(ui+"/api/import/history",{
 method:"DELETE",headers:{...httpHeaders,"content-type":"application/json"},
 body:JSON.stringify({ids:[preview.historyId]})
})).data;
assert.equal(deleted.deleted,1);
await request(ui+"/api/import",{
 method:"POST",headers:httpHeaders,body:historyMultipart(preview.historyId,"preview"),expected:400
});
console.log("PASS: preview, history replay with fresh catalog, staged update, created product, stock=0, selected history deletion.");
console.log("Only localhost API used; no production Supabase writes.");
