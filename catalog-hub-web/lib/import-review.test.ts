import test from "node:test";
import assert from "node:assert/strict";
import { evaluateImport, type Existing } from "./import-review";

const product:Existing={
  id:"p1",sku:"JD-096OVY8",barcode:"1234567890123",title:"Mask Black for White",
  brand:"JeuDerm",purchasePrice:19000,price:27510,description:"Описание",
  categoryKey:"Осветление",updatedAt:"2026-10-12T04:00:00Z"
};
const row={rowNumber:2,sku:"JD-096OVY8",barcode:"1234567890123",title:"Mask Black for White",
 price:27600,errors:[]};
test("existing SKU produces reviewed delta, not an immediate mutation",()=>{
 const original={...product};
 const x=evaluateImport([row],[product],["Осветление"])[0];
 assert.equal(x.status,"UPDATE");assert.equal(x.matchedBy,"SKU");
 assert.deepEqual(x.changes,[{field:"price",before:27510,after:27600}]);
 assert.deepEqual(product,original);
 assert.equal("stock" in x.proposed,false);
});
test("unique barcode matches even when supplied supplier SKU differs",()=>{
 const x=evaluateImport([{...row,sku:"SUPPLIER-CODE"}],[product],["Осветление"])[0];
 assert.equal(x.status,"UPDATE");
 assert.equal(x.matchedBy,"BARCODE");assert.equal(x.productId,"p1");
 assert.equal("sku" in x.proposed,false);
});
test("supplier-specific SKU finds the linked product without a barcode",()=>{
 const linked={...product,supplierLinks:[{supplierId:"supplier-1",supplierSku:"SUPPLIER-CODE"}]};
 const x=evaluateImport([{...row,sku:"SUPPLIER-CODE",barcode:""}],[linked],["Осветление"],"supplier-1")[0];
 assert.equal(x.status,"UPDATE");assert.equal(x.productId,"p1");
 assert.equal(x.matchedBy,"SUPPLIER_SKU");
 const another=evaluateImport([{...row,sku:"SUPPLIER-CODE",barcode:""}],[linked],["Осветление"],"supplier-2")[0];
 assert.equal(another.status,"CREATE");
});
test("conflicting SKU and barcode are blocked",()=>{
 const second={...product,id:"p2",sku:"JD-OTHER",barcode:"5555555555555"};
 const x=evaluateImport([{...row,barcode:"5555555555555"}],[product,second],["Осветление"])[0];
 assert.equal(x.status,"CONFLICT");
});
test("repeated SKU in file is blocked on both rows",()=>{
 const xs=evaluateImport([row,{...row,rowNumber:3}],[product],["Осветление"]);
 assert.equal(xs[0].status,"DUPLICATE");
 assert.equal(xs[1].status,"DUPLICATE");
});
test("new product requires own SKU and name",()=>{
 const x=evaluateImport([{rowNumber:2,sku:"",barcode:"987",title:"",errors:[]}],[],[])[0];
 assert.equal(x.status,"INVALID");
});
test("no changes are staged for identical values",()=>{
 const x=evaluateImport([{...row,price:27510}],[product],["Осветление"])[0];
 assert.equal(x.status,"SAME");
});
test("unknown category is rejected",()=>{
 const x=evaluateImport([{...row,categoryKey:"Случайная"}],[product],["Осветление"])[0];
 assert.equal(x.status,"INVALID");
});
test("quantity never becomes a product field patch",()=>{
 const x=evaluateImport([{...row,stock:999}],[product],["Осветление"])[0];
 assert.equal(x.sourceStock,999);
 assert.equal(x.proposed.stock,undefined);
});
