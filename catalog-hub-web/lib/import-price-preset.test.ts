import assert from "node:assert/strict";
import test from "node:test";
import {defaultImportMapping,isJeudermPriceList} from "./import-price-preset";
import {priceImportItems,DEFAULT_PRICE_RULE} from "./import-pricing";

const headers=["Артикул","Наименование","Цена 1","Цена 2"];

test("JeuDerm PDF maps purchase and ready retail prices without markup",()=>{
  const mapping=defaultImportMapping("JeuDerm Космецевтика.pdf","PDF",headers,{sku:"Артикул",title:"Наименование"});
  assert.equal(mapping.purchasePrice,"Цена 1");
  assert.equal(mapping.price,"Цена 2");
  const [item]=priceImportItems([{
    rowNumber:2,sku:"JDR-1",barcode:"",title:"Cleanser",
    purchasePrice:13100,price:19000,errors:[],
  }],DEFAULT_PRICE_RULE);
  assert.equal(item.purchasePrice,13100);
  assert.equal(item.price,19000);
});

test("unconfirmed supplier prices remain unmapped",()=>{
  const mapping={sku:"Артикул" as const};
  assert.equal(isJeudermPriceList("Other.pdf","PDF",headers),false);
  assert.deepEqual(defaultImportMapping("Other.pdf","PDF",headers,mapping),mapping);
  assert.deepEqual(defaultImportMapping("JeuDerm.xlsx","XLSX",headers,mapping),mapping);
});
