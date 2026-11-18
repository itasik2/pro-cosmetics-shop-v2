import test from "node:test";
import assert from "node:assert/strict";
import {packageIdentity,supplierPackage,titleWithoutPackage} from "./supplier-package";
import {suggestRelationships} from "./import-relationships";
test("supplier packaging names keep the actual size and raw source",()=>{
  assert.deepEqual(supplierPackage("Банка 210 г"),{value:210,unit:"g",raw:"Банка 210 г"});
  assert.equal(packageIdentity("Дой-пак 1 кг"),"1000:g");
  assert.equal(packageIdentity("Саше 30 г"),"30:g");
  assert.equal(supplierPackage("Коробка, 5 х 30 г"),null);
});
test("only a confirmed trailing package is removed from the common title",()=>{
  assert.equal(titleWithoutPackage("Тестовая маска (30 г)","Саше 30 г"),"Тестовая маска");
  assert.equal(titleWithoutPackage("Крем 50 мл","100 мл"),"Крем 50 мл");
  assert.equal(titleWithoutPackage("Набор 30 мл + крем 50 мл","50 мл"),"Набор 30 мл + крем 50 мл");
});
test("three explicit supplier packs are variant candidates with individual SKUs",()=>{
  const result=suggestRelationships(["Саше 30 г","Банка 210 г","Дой-пак 1 кг"].map((volume,index)=>({
    rowNumber:index+2,sku:"TEST"+index,title:"Тестовая маска",brand:"Test",barcode:"",volume,errors:[],
  })));
  assert.ok(result.every(r=>r?.kind==="VARIANT"));
  assert.deepEqual(result[0]?.indices,[1,2]);
});
test("large duplicate groups have bounded preview payloads",()=>{
  const result=suggestRelationships(Array.from({length:10000},(_,i)=>({rowNumber:i+2,sku:"TEST"+i,title:"Тестовая маска",brand:"Test",barcode:"",volume:"Саше 30 г",errors:[]})));
  assert.equal(result.length,10000);
  assert.equal(result[9999]?.totalPeers,9999);
  assert.ok(result.every(r=>r&&r.indices.length===20));
});
