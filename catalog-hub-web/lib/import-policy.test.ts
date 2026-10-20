import {test} from "node:test";
import {strict as assert} from "node:assert";
import {decideImportPrice,missingSupplierPositions} from "./import-policy";
import type {Existing,Reviewed} from "./import-review";

const now=new Date("2026-10-20T10:00:00Z");
const supplierId="supplier-1";
const product:Existing={
 id:"product-1",sku:"SKU-1",barcode:null,title:"Product One",brand:"Brand",
 price:1000,purchasePrice:500,description:null,categoryKey:null,updatedAt:"2026-10-19T12:00:00Z",
 stock:4,attributes:{supplierImport:{supplierId,sourceDate:"2026-10-18"}},
 supplierLinks:[{supplierId,supplierSku:"SKU-1"}],
};
const row:Reviewed={index:0,rowNumber:2,sku:"SKU-1",barcode:"",title:"Product One",
 matchedBy:"SKU",productId:product.id,status:"UPDATE",reasons:[],currentUpdatedAt:product.updatedAt,
 proposed:{title:"Product One",price:1200,purchasePrice:600},
 changes:[{field:"price",before:1000,after:1200},{field:"purchasePrice",before:500,after:600}],
 sourceStock:9};

test("only a later price increase from the same supplier and exact SKU is automatic",()=>{
 assert.equal(decideImportPrice(row,product,supplierId,"2026-10-19",now),"AUTO_INCREASE");
 assert.equal(decideImportPrice(row,product,"other-supplier","2026-10-19",now),"REVIEW_FIRST");
 assert.equal(decideImportPrice({...row,matchedBy:"BARCODE"},product,supplierId,"2026-10-19",now),"REVIEW_IDENTITY");
 assert.equal(decideImportPrice({...row,proposed:{price:1200}},product,supplierId,"2026-10-19",now),"REVIEW_IDENTITY");
 assert.equal(decideImportPrice({...row,changes:[...row.changes,{field:"description",before:null,after:"new"}]},
   product,supplierId,"2026-10-19",now),"REVIEW_OTHER");
});
test("lower, undated, future and older prices require review or are blocked",()=>{
 assert.equal(decideImportPrice({...row,changes:[{field:"price",before:1000,after:900}]},
   product,supplierId,"2026-10-19",now),"REVIEW_DECREASE");
 assert.equal(decideImportPrice(row,product,supplierId,"2026-10-18",now),"REVIEW_SAME_DATE");
 assert.equal(decideImportPrice(row,product,supplierId,"2026-10-17",now),"OLDER");
 assert.equal(decideImportPrice(row,product,supplierId,null,now),"NO_DATE");
 assert.equal(decideImportPrice(row,product,supplierId,"2026-10-21",now),"FUTURE");
});
test("first unchanged row can be linked; absent positions are reported without stock mutation",()=>{
 const second={...product,id:"product-2",sku:"SKU-2",title:"Product Two"};
 const unchanged:Reviewed={...row,status:"SAME",changes:[],sku:second.sku,productId:second.id};
 assert.equal(decideImportPrice(unchanged,{...second,supplierLinks:[]},supplierId,"2026-10-19",now),"REVIEW_FIRST");
 assert.deepEqual(missingSupplierPositions([row],[product,second],supplierId,"2026-10-19")
  .map(p=>[p.sku,p.stock]),[["SKU-2",4]]);
 assert.deepEqual(missingSupplierPositions([row],[product],supplierId,"2026-10-17"),[]);
});
