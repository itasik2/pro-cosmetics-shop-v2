import {readFileSync} from "node:fs";
import {randomBytes} from "node:crypto";
import {resolve} from "node:path";
import assert from "node:assert/strict";

const base="http://127.0.0.1:8000";
const key=JSON.parse(readFileSync(resolve("catalog-hub-local/.test-credentials.json"),"utf8")).key;
const headers={"x-catalog-hub-key":key,"content-type":"application/json"};
async function request(path,options={}){
 const res=await fetch(base+path,{...options,signal:AbortSignal.timeout(8000)});
 const raw=await res.text();
 let data=null;
 try{data=JSON.parse(raw)}catch{data=raw}
 return {status:res.status,data};
}
async function untilReady(){
 for(let i=0;i<60;i++){
  try{
   const r=await request("/health");
   if(r.status===200)return;
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,2000));
 }
 throw new Error("Local Deno API did not become ready in time. Inspect docker compose logs.");
}
await untilReady();
const bad=await request("/v1/catalog/product-options?organizationId=org_procosmetics");
assert.equal(bad.status,401,"Catalog Hub API must reject unauthenticated requests");
const catalog=await request("/v1/catalog/product-options?organizationId=org_procosmetics",{headers});
assert.equal(catalog.status,200,JSON.stringify(catalog.data).slice(0,500));
assert.ok(Array.isArray(catalog.data),"expected array of product options");
assert.ok(catalog.data.length>=3,"expected synthetic demo fixtures");
assert.ok(catalog.data.some(p=>p.sku==="TEST-LOCAL-001"));

const sku="TEST-SMOKE-"+randomBytes(4).toString("hex").toUpperCase();
const create=await request("/v1/catalog/products",{
 method:"POST",headers,body:JSON.stringify({
  organizationId:"org_procosmetics",
  card:{sku,title:"Synthetic smoke-test product",brand:"Demo",purchasePrice:1000,price:1500},
 })
});
assert.equal(create.status,201,JSON.stringify(create.data).slice(0,500));
const updated=await request("/v1/catalog/product-options?organizationId=org_procosmetics",{headers});
assert.equal(updated.status,200);
assert.ok(updated.data.some(p=>p.sku===sku));
console.log("Local Catalog Hub smoke: API authenticated, fixtures loaded, test-only write works.");
