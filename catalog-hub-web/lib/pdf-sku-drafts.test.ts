import test from "node:test";
import assert from "node:assert/strict";
import {draftInternalSku,draftPdfSkuOverrides,countDuplicateSkuDrafts,validPrefix} from "./pdf-sku-drafts";

test("internal draft IDs are reproducible and distinguish pack volumes",()=>{
 const a=draftInternalSku("JDR","ReformAge O2 Fluid (50 мл)");
 const b=draftInternalSku("JDR","ReformAge O2 Fluid (110 мл)");
 assert.notEqual(a,b);
 assert.equal(a,draftInternalSku("jdr","  ReformAge   O2 Fluid (50 мл)  "));
 assert.match(a,/^JDR-REFORMAGE-O2-FLUID-50-[A-F0-9]{8}$/);
});
test("does not replace manually entered SKU or a row with official SKU",()=>{
 const proposals=draftPdfSkuOverrides([
  {index:0,sku:"",title:"My Ato Intensive Cream (50 мл)"},
  {index:1,sku:"OFFICIAL-123",title:"Some Serum"},
  {index:2,sku:"",title:"Other Gel"},
 ],"JDR",{0:"CUSTOM-APPROVED"});
 assert.equal(proposals[0],"CUSTOM-APPROVED");
 assert.equal(proposals[1],undefined);
 assert.match(proposals[2],/^JDR-OTHER-GEL-[A-F0-9]{8}$/);
});
test("identical titles remain duplicates and are not arbitrarily deduplicated",()=>{
 const p=draftPdfSkuOverrides([
  {index:0,sku:"",title:"Mask (50 мл)"},
  {index:1,sku:"",title:"Mask (50 мл)"},
 ],"JDR",{});
 assert.equal(p[0],p[1]);
 assert.equal(countDuplicateSkuDrafts(p),1);
});
test("draft SKU prefix validation is strict",()=>{
 for(const x of ["","A","MЫ","A/B","_SUPPLIER","LONGPREFIX12345"])assert.equal(validPrefix(x),false);
 for(const x of ["JDR","SUPPLIER09"])assert.equal(validPrefix(x),true);
 assert.throws(()=>draftInternalSku("X","My Ato Intensive Cream"),/sku_prefix_invalid/);
 assert.throws(()=>draftInternalSku("JDR","  "),/sku_title_missing/);
});
