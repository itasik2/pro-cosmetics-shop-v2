import type {ImportItem} from "./import-parser";

export type Existing = {
 id:string;sku:string;barcode:string|null;title:string;brand:string|null;
 purchasePrice:number|null;price:number|null;description:string|null;
 categoryKey:string|null;updatedAt:string;stock?:number;
 attributes?:Record<string,unknown>;
 supplierLinks?:Array<{supplierId:string;supplierSku:string|null}>;
};
export type Reviewed = {
 index:number;rowNumber:number;sku:string;title:string;barcode:string;
 matchedBy:"SKU"|"SUPPLIER_SKU"|"BARCODE"|null;productId:string|null;
 status:"CREATE"|"UPDATE"|"SAME"|"CONFLICT"|"DUPLICATE"|"INVALID";
 reasons:string[];currentUpdatedAt:string|null;
 proposed:Record<string,string|number|null>;
 changes:Array<{field:string;before:string|number|null;after:string|number|null}>;
 sourceStock:number|null;
};

export function evaluateImport(items:ImportItem[],existing:Existing[],categoryKeys:string[],supplierId?:string):Reviewed[]{
 const skus=new Map<string,Existing>(),supplierSkus=new Map<string,Existing[]>(),barcodes=new Map<string,Existing[]>();
 for(const p of existing){
   skus.set(p.sku.trim().toUpperCase(),p);
   for(const link of p.supplierLinks||[]){
     if(link.supplierId===supplierId&&link.supplierSku?.trim()){
       const key=link.supplierSku.trim().toUpperCase(),prior=supplierSkus.get(key)||[];
       prior.push(p);supplierSkus.set(key,prior);
     }
   }
   if(p.barcode?.trim()){
     const code=p.barcode.trim(),prior=barcodes.get(code)||[];
     prior.push(p);barcodes.set(code,prior);
   }
 }
 const skuCount=new Map<string,number>(),barcodeCount=new Map<string,number>();
 for(const item of items){
   if(item.sku){const key=item.sku.trim().toUpperCase();skuCount.set(key,(skuCount.get(key)||0)+1);}
   if(item.barcode){barcodeCount.set(item.barcode,(barcodeCount.get(item.barcode)||0)+1);}
 }
 const allowed=new Set(categoryKeys);
 return items.map((item,index)=>{
   const errors=[...item.errors];
   if(item.sku&&skuCount.get(item.sku.toUpperCase())!>1) errors.push("Повтор SKU внутри файла");
   if(item.barcode&&barcodeCount.get(item.barcode)!>1) errors.push("Повтор штрихкода внутри файла");
   const skuMatch=item.sku?skus.get(item.sku.toUpperCase()):undefined;
   const supplierMatches=item.sku?supplierSkus.get(item.sku.toUpperCase())||[]:[];
   if(supplierMatches.length>1)errors.push("Артикул поставщика принадлежит нескольким товарам");
   const supplierMatch=supplierMatches.length===1?supplierMatches[0]:undefined;
   const barcodeMatches=item.barcode?barcodes.get(item.barcode)||[]:[];
   if(barcodeMatches.length>1)errors.push("Штрихкод принадлежит нескольким товарам");
   const barcodeMatch=barcodeMatches.length===1?barcodeMatches[0]:undefined;
   if(skuMatch&&barcodeMatch&&skuMatch.id!==barcodeMatch.id)errors.push("SKU и штрихкод ведут к разным товарам");
   if(supplierMatch&&((skuMatch&&skuMatch.id!==supplierMatch.id)||
       (barcodeMatch&&barcodeMatch.id!==supplierMatch.id)))errors.push("Артикул поставщика и SKU/штрихкод ведут к разным товарам");
   if(item.categoryKey&&!allowed.has(item.categoryKey))errors.push("Категория отсутствует в справочнике Catalog Hub");
   if(!item.sku&&!barcodeMatch)errors.push("Новый товар требует SKU");
   const product=skuMatch||supplierMatch||barcodeMatch||null;
   if(!product&&!item.title)errors.push("Новый товар требует название");
   const proposed:Reviewed["proposed"]={};
   const add=(field:string,value:string|number|undefined)=>{
     if(value!==undefined&&value!=="")proposed[field]=value;
   };
   add("title",item.title);add("barcode",item.barcode);add("brand",item.brand);
   add("description",item.description);add("categoryKey",item.categoryKey);
   add("purchasePrice",item.purchasePrice);add("price",item.price);
   const changes:Reviewed["changes"]=[];
   if(product){
     for(const [field,after] of Object.entries(proposed)){
       const before=(product as unknown as Record<string,unknown>)[field]??null;
       if(String(before??"")!==String(after??""))
         changes.push({field,before:before as string|number|null,after});
     }
   }
   const isDuplicate=errors.some(e=>e.startsWith("Повтор"));
   const isConflict=errors.some(e=>e.includes("разным товарам")||e.includes("нескольким товарам"));
   const status:Reviewed["status"]=isDuplicate?"DUPLICATE":
      isConflict?"CONFLICT":errors.length?"INVALID":
      !product?"CREATE":changes.length?"UPDATE":"SAME";
   return {
     index,rowNumber:item.rowNumber,sku:item.sku,title:item.title||product?.title||"",
     barcode:item.barcode,matchedBy:skuMatch?"SKU":supplierMatch?"SUPPLIER_SKU":barcodeMatch?"BARCODE":null,
     productId:product?.id||null,status,reasons:errors,
     currentUpdatedAt:product?.updatedAt||null,proposed,changes,
     sourceStock:item.stock??null,
   };
 });
}
