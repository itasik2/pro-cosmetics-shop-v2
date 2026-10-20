import { NextRequest,NextResponse } from "next/server";
import {createHmac,createHash,timingSafeEqual} from "node:crypto";
import {hubFetch,organizationId} from "@/lib/hub";
import {parseTable,mapImport,autoMapping,type Table} from "@/lib/import-parser";
import {type Mapping,type Field} from "@/lib/import-types";
import {evaluateImport,type Existing} from "@/lib/import-review";
import {isLocalReadOnly} from "@/lib/local-mode";
import {isSameOrigin} from "@/lib/same-origin";
import {listSupplierProfiles,listLocalImportHistory,loadLocalImportSnapshot,recordLocalImportEvent,type LocalImportSnapshot} from "@/lib/local-supplier-store";
import {buildUniversalCatalog} from "@/lib/universal-catalog";
import {parsePriceRule,priceImportItems,type PriceRule} from "@/lib/import-pricing";
import {defaultImportMapping,isJeudermPriceList} from "@/lib/import-price-preset";
import {dateFromFileName,previousAppliedDate} from "@/lib/import-date";
import {decideImportPrice,missingSupplierPositions,validSourceDate,type ImportPolicyRow} from "@/lib/import-policy";

export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=60;

type Catalog={items:Existing[];total:number};
type Categories={categories:Array<{key:string;isActive:boolean}>};
type Supplier={id:string;isActive:boolean};
const MAPPED_FIELDS=new Set<Field>([
 "sku","barcode","title","brand","volume","purchasePrice","price","description","categoryKey","stock"
]);

function responseError(message:string,status=400){
 return NextResponse.json({error:message},{status,headers:{"cache-control":"no-store"}});
}
function secret(){
 const s=process.env.CATALOG_HUB_UI_SESSION_TOKEN||"";
 if(s.length<24)throw new Error("import_session_secret_not_configured");
 return s;
}
function fileHash(file:File) {
 return file.arrayBuffer().then(buffer=>createHash("sha256").update(Buffer.from(buffer)).digest("hex"));
}
function digest(fileDigest:string,mapping:Mapping,priceRule:PriceRule,review:ImportPolicyRow[],supplierId:string|null,sourceDate:string|null){
 const data=JSON.stringify({
   org:organizationId,fileDigest,mapping,priceRule,supplierId,sourceDate,
   rows:review.map(x=>[x.rowNumber,x.sku,x.barcode,x.productId,x.status,x.currentUpdatedAt,x.priceDecision,x.proposed,x.changes])
 });
 return createHmac("sha256",secret()).update(data).digest("hex");
}
function equalSignature(a:string,b:string){
 return /^[a-f0-9]{64}$/.test(a)&&timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}
function mappingFrom(raw:FormDataEntryValue|null,headers:string[]):Mapping{
 if(typeof raw!=="string"||!raw.trim())return autoMapping(headers);
 let obj:unknown;
 try{obj=JSON.parse(raw)}catch{throw new Error("invalid_mapping");}
 if(!obj||typeof obj!=="object"||Array.isArray(obj))throw new Error("invalid_mapping");
 const output:Mapping={};
 const selectedCols=new Set<string>();
 for(const [key,column] of Object.entries(obj)){
  if(!MAPPED_FIELDS.has(key as Field)||typeof column!=="string")throw new Error("invalid_mapping_field");
  if(!column)continue;
  if(!headers.includes(column))throw new Error("invalid_mapping_column");
  if(selectedCols.has(column))throw new Error("same_column_mapped_twice");
  selectedCols.add(column);
  output[key as Field]=column;
 }
 return output;
}
async function prepare(request:NextRequest){
 if(Number(request.headers.get("content-length")||0)>10*1024*1024)throw new Error("upload_too_large");
 const data=await request.formData();
 const file=data.get("file");
 let table:Table,originalRows:Array<Record<string,string>>,hash:string,fileName:string;
 let storedMapping:Mapping|undefined,storedOverrides:Record<string,string>={};
 let storedPriceRule:PriceRule|undefined;
 let historyProfileId:string|null=null;
 if(file instanceof File){
   table=await parseTable(file);
   originalRows=table.rows.map(row=>({...row}));
   hash=await fileHash(file);fileName=file.name;
 }else{
   if(process.env.CATALOG_HUB_LOCAL_MODE!=="true")throw new Error("local_mode_required");
   const id=data.get("historyId");
   if(typeof id!=="string")throw new Error("file_required");
   const saved=await loadLocalImportSnapshot(organizationId,id);
   table={...saved.snapshot.table,rows:saved.snapshot.originalRows.map(row=>({...row}))};
   originalRows=saved.snapshot.originalRows.map(row=>({...row}));
   hash=saved.snapshot.fileSha256;fileName=saved.entry.fileName;
   storedMapping=saved.snapshot.mapping;storedOverrides=saved.snapshot.skuOverrides;
   storedPriceRule=saved.snapshot.priceRule;
   historyProfileId=saved.entry.profileId;
 }
 const skuOverrideRaw=data.get("skuOverrides")??(table.format==="PDF"?JSON.stringify(storedOverrides):null);
 let skuOverrides:Record<string,string>={};
 if(skuOverrideRaw){
   if(table.format!=="PDF"||typeof skuOverrideRaw!=="string"||skuOverrideRaw.length>25000)
     throw new Error("invalid_pdf_sku_overrides");
   let overrides:unknown;
   try{overrides=JSON.parse(skuOverrideRaw)}catch{throw new Error("invalid_pdf_sku_overrides");}
   if(!overrides||typeof overrides!=="object"||Array.isArray(overrides)||
       Object.keys(overrides).length>table.rows.length)throw new Error("invalid_pdf_sku_overrides");
   skuOverrides=overrides as Record<string,string>;
   for(const [index,value] of Object.entries(overrides)){
     const number=Number(index);
     if(!/^\d+$/.test(index)||!Number.isSafeInteger(number)||number>=table.rows.length||
         typeof value!=="string"||value.length>100||
         (value.trim()!==""&&!/^[\p{L}\p{N}][\p{L}\p{N}_.\/-]*$/u.test(value.trim())))
       throw new Error("invalid_pdf_sku_overrides");
     table.rows[number]["Артикул"]=value.trim();
   }
 }
 const suppliedMapping=data.get("mapping")??(storedMapping?JSON.stringify(storedMapping):null);
 const mapping=suppliedMapping===null
   ?defaultImportMapping(fileName,table.format,table.headers,autoMapping(table.headers))
   :mappingFrom(suppliedMapping,table.headers);
 const priceRule=parsePriceRule(data.get("priceRule")??storedPriceRule);
 const rawSupplier=data.get("supplierId");
 const supplierId=typeof rawSupplier==="string"&&rawSupplier?rawSupplier:null;
 if(supplierId&&supplierId.length>128)throw new Error("invalid_supplier");
 const effectiveMapping=priceRule.mode==="PRICE_AS_IS"?mapping:{...mapping,price:undefined};
 const items=priceImportItems(mapImport(table,effectiveMapping),priceRule);
 // PDF booklets have two unlabeled commercial amounts. Require an explicit
 // retail-price column choice; never create an unpriced or guessed-price card.
 if(table.format==="PDF"){
   for(const item of items){
     if(priceRule.mode==="PRICE_AS_IS"){
       if(!mapping.price)item.errors.push("PDF: выберите розничную цену (Цена 1 или Цена 2) в сопоставлении колонок");
       else if(item.price===undefined)item.errors.push("PDF: выбранная колонка розничной цены пуста");
     }
   }
 }
 const [currentCatalog,categories,suppliers]=await Promise.all([
   hubFetch<Catalog>("/v1/catalog/snapshot?organizationId="+encodeURIComponent(organizationId)),
   hubFetch<Categories>("/v1/categories?organizationId="+encodeURIComponent(organizationId)),
   process.env.CATALOG_HUB_LOCAL_MODE==="true"?Promise.resolve([] as Supplier[]):
     hubFetch<Supplier[]>("/v1/suppliers?organizationId="+encodeURIComponent(organizationId)),
 ]);
 if(supplierId&&!suppliers.some(s=>s.id===supplierId&&s.isActive))throw new Error("supplier_not_found");
 if(!supplierId&&process.env.CATALOG_HUB_LOCAL_MODE!=="true")throw new Error("supplier_required");
 const preliminary=evaluateImport(items,currentCatalog.items,categories.categories.filter(c=>c.isActive).map(c=>c.key),supplierId||undefined);
 const enteredDate=data.get("sourceDate");
 const sourceDate=typeof enteredDate==="string"&&enteredDate?enteredDate:dateFromFileName(fileName);
 if(sourceDate&&!validSourceDate(sourceDate))throw new Error("invalid_source_date");
 const byId=new Map(currentCatalog.items.map(p=>[p.id,p]));
 const review:ImportPolicyRow[]=preliminary.map(row=>({
   ...row,priceDecision:decideImportPrice(row,row.productId?byId.get(row.productId):undefined,supplierId,sourceDate),
 }));
 if(supplierId){
   const supplierSkuToProduct=new Map<string,string>();
   for(const product of currentCatalog.items){
     for(const link of product.supplierLinks||[]){
       if(link.supplierId===supplierId&&link.supplierSku)
         supplierSkuToProduct.set(link.supplierSku.trim().toUpperCase(),product.id);
     }
   }
   for(const row of review){
     const suppliedSku=mapping.sku?originalRows[row.index]?.[mapping.sku]?.trim():null;
     const linked=suppliedSku&&supplierSkuToProduct.get(suppliedSku.toUpperCase());
     if(linked&&linked!==row.productId){
       row.status="CONFLICT";row.priceDecision="BLOCKED";
       row.reasons.push("Артикул поставщика уже привязан к другой карточке");
     }
   }
 }
 if(priceRule.mode==="SOURCE_ONLY"){
   for(const row of review){
     if(row.status==="CREATE"){
       row.status="INVALID";
       row.reasons.push("Режим «Только закупочная цена» применяется к существующим товарам; для нового товара выберите правило розничной цены");
     }
   }
 }
 const universalCatalog=buildUniversalCatalog({fileName,fileSha256:hash,table,mapping,priceRule,items,review,originalRows});
 for(const row of universalCatalog.products){
   if(row.identity.productId){
     row.identity.internalSku=currentCatalog.items.find(p=>p.id===row.identity.productId)?.sku||row.identity.internalSku;
   }
 }
 const sourceBase=createHash("sha256").update(hash+JSON.stringify(mapping)+(supplierId||"")+(sourceDate||"")).digest("hex").slice(0,32);
 let profileId:string|null=null;
 if(process.env.CATALOG_HUB_LOCAL_MODE==="true"){
   const requested=data.get("profileId")||historyProfileId;
   if(typeof requested==="string"&&requested){
     const profiles=await listSupplierProfiles(organizationId);
     if(profiles.some(p=>p.id===requested))profileId=requested;
     else if(data.get("profileId"))throw new Error("supplier_profile_not_found");
   }
 }
 const appliedDate=process.env.CATALOG_HUB_LOCAL_MODE==="true"
   ?previousAppliedDate(await listLocalImportHistory(organizationId),profileId):null;
 const olderThanApplied=Boolean(sourceDate&&appliedDate&&sourceDate<appliedDate);
 const {rows:_parsedRows,...tableMetadata}=table;
 const snapshot:LocalImportSnapshot={table:tableMetadata,originalRows,fileSha256:hash,mapping,skuOverrides,priceRule};
 const missingPositions=missingSupplierPositions(review,currentCatalog.items,supplierId,sourceDate);
 return {data,fileName,fileSha256:hash,table,mapping,priceRule,review,sourceBase,profileId,supplierId,sourceDate,
   appliedDate,olderThanApplied,missingPositions,universalCatalog,snapshot,byId,
   fingerprint:digest(hash,mapping,priceRule,review,supplierId,sourceDate)};
}
export async function POST(request:NextRequest) {
 if(!isSameOrigin(request))return responseError("invalid_origin",403);
 let state:Awaited<ReturnType<typeof prepare>>;
 try{state=await prepare(request);}
 catch(e){const msg=e instanceof Error?e.message:"import_preview_failed";
   return responseError(msg,/too_large|size_limit|too_many/.test(msg)?413:400);}
 const {data,table,mapping,priceRule,review,fingerprint}=state;
 const action=data.get("action")==="apply"?"apply":"preview";
 const counts=Object.fromEntries(["CREATE","UPDATE","SAME","INVALID","CONFLICT","DUPLICATE"].map(s=>
    [s,review.filter(r=>r.status===s).length]));
 if(action==="preview"){
   let historyId:string|null=null;
   let historyWarning:string|null=null;
   if(process.env.CATALOG_HUB_LOCAL_MODE==="true"){
     try{
       const entry=await recordLocalImportEvent({
         organizationId,profileId:state.profileId,
         sourceDate:state.sourceDate,
         fileName:state.fileName,format:table.format,action:"PREVIEW",
         result:"PREVIEWED",totalRows:review.length,countByStatus:counts,
         selectedRows:0,snapshot:state.snapshot,
       });
       historyId=entry.id;
     }catch(e){console.error("local_import_history_failed",e);
       historyWarning="Не удалось сохранить строки в локальной истории. Для повторной загрузки понадобится исходный файл.";}
   }
   return NextResponse.json({
     format:table.format,fileName:state.fileName,headers:table.headers,mapping,priceRule,review,counts,fingerprint,
     jeudermPriceRule:isJeudermPriceList(state.fileName,table.format,table.headers),
     historyId,historyWarning,pdfSkuOverrides:state.snapshot.skuOverrides,
     supplierId:state.supplierId,sourceDate:state.sourceDate,appliedDate:state.appliedDate,
     olderThanApplied:state.olderThanApplied,missingPositions:state.missingPositions,
     universalCatalog:state.universalCatalog,
     warnings:table.warnings||[],pageCount:table.pageCount||null,
     pdfSource:table.format==="PDF"?table.rows.map((x,index)=>({
       index,page:x["Страница"]||"",
       volume:x["Объем"]||"",
       price1:x["Цена 1"]||"",
       price2:x["Цена 2"]||"",
     })):[],
     needsManualSku:table.needsManualSku||false,
     canApply:!isLocalReadOnly(),
     note:"Проверяйте спорные цены и исчезнувшие позиции. Остатки в файле носят справочный характер."
   },{headers:{"cache-control":"no-store"}});
 }
 if(data.get("confirmed")!=="yes")return responseError("confirmation_required");
 if(isLocalReadOnly())return responseError("local_read_only_mode: сохранение товаров отключено до подключения тестовой базы.",403);
 if(!state.supplierId)return responseError("supplier_required");
 const signature=data.get("fingerprint");
 if(typeof signature!=="string"||!equalSignature(signature,fingerprint))
   return responseError("preview_expired_or_catalog_changed",409);
 let selected:unknown;
 try{selected=JSON.parse(String(data.get("selected")||"[]"));}
 catch{return responseError("invalid_selection");}
 if(!Array.isArray(selected)||selected.length<1||selected.length>20||
    selected.some(v=>!Number.isInteger(v)||v<0||v>=review.length)||
    new Set(selected).size!==selected.length)return responseError("select_up_to_20_rows");
 const candidates=selected.map(i=>review[i as number]);
 if(candidates.some(r=>!["CREATE","UPDATE"].includes(r.status)&&
      !(r.status==="SAME"&&r.priceDecision==="REVIEW_FIRST")||
    ["NO_DATE","FUTURE","OLDER","BLOCKED"].includes(r.priceDecision)))
   return responseError("selection_has_conflicts_or_unsafe_price",409);
 const results:Array<{rowNumber:number;sku:string;status:string;id?:string;error?:string}>=[];
 for(const item of candidates){
  try{
   if(item.priceDecision==="AUTO_INCREASE"&&item.productId){
     const current=state.byId.get(item.productId)!;
     const changed=Object.fromEntries(item.changes.filter(c=>c.field==="price"||c.field==="purchasePrice")
       .map(c=>[c.field,c.after]));
     const applied=await hubFetch<{id:string}>("/v1/price-import/auto",{
       method:"POST",body:JSON.stringify({organizationId,supplierId:state.supplierId,
         productId:item.productId,sku:item.sku,title:current.title,brand:current.brand,
         sourceDate:state.sourceDate,fileName:state.fileName,fileSha256:state.fileSha256,...changed}),
     });
     results.push({rowNumber:item.rowNumber,sku:item.sku,status:"AUTO_APPLIED",id:applied.id});
   }else if(item.status==="UPDATE"||item.status==="SAME"){
     const current=state.byId.get(item.productId!)!;
     const proposed:Record<string,unknown>=Object.fromEntries(item.changes.map(c=>[c.field,c.after]));
     if(state.sourceDate){
       proposed.attributes={...(current.attributes||{}),supplierImport:{
         ...(current.attributes?.supplierImport&&typeof current.attributes.supplierImport==="object"
           ?current.attributes.supplierImport as Record<string,unknown>:{}),
         ...state.universalCatalog.source,
         ...state.universalCatalog.products[item.index].provenance,
         supplierId:state.supplierId,
         supplierSku:state.universalCatalog.products[item.index].identity.supplierSku,
         sourceDate:state.sourceDate,
         sha256:state.fileSha256,
       }};
     }
     const staged=await hubFetch<{id:string;status:string}>("/v1/staging/changesets",{
       method:"POST",body:JSON.stringify({
         organizationId,productId:item.productId,
         sourceType:"IMPORT",sourceRef:"supplierfile:"+state.sourceBase+":"+item.index,
         proposed,
       }),
     });
     results.push({rowNumber:item.rowNumber,sku:item.sku,status:"STAGED",id:staged.id});
   }else{
     // No stock is created, even when the supplier file contains a quantity.
     const created=await hubFetch<{id:string}>("/v1/catalog/products",{
       method:"POST",body:JSON.stringify({
         organizationId,supplierId:state.supplierId,
         supplierSku:state.universalCatalog.products[item.index].identity.supplierSku,card:{
           sku:item.sku,title:item.title,
           attributes:{
             newArrival:true,
             ...(state.universalCatalog.products[item.index].card.variant?{
               volumeValue:state.universalCatalog.products[item.index].card.variant!.value,
               volumeUnit:state.universalCatalog.products[item.index].card.variant!.unit,
             }:{}),
             supplierImport:{
               ...state.universalCatalog.source,
               ...state.universalCatalog.products[item.index].provenance,
               supplierId:state.supplierId,sourceDate:state.sourceDate,sha256:state.fileSha256,
               supplierSku:state.universalCatalog.products[item.index].identity.supplierSku,
               sourceAmounts:state.universalCatalog.products[item.index].prices.sourceAmounts,
             },
           },
           ...(item.proposed.barcode?{barcode:item.proposed.barcode}:{}),
           ...(item.proposed.brand?{brand:item.proposed.brand}:{}),
           ...(item.proposed.description?{description:item.proposed.description}:{}),
           ...(item.proposed.categoryKey?{categoryKey:item.proposed.categoryKey}:{}),
           ...(item.proposed.purchasePrice!==undefined?{purchasePrice:item.proposed.purchasePrice}:{}),
           ...(item.proposed.price!==undefined?{price:item.proposed.price}:{}),
         },
       }),
     });
     results.push({rowNumber:item.rowNumber,sku:item.sku,status:"CREATED",id:created.id});
   }
  }catch(e){
   results.push({rowNumber:item.rowNumber,sku:item.sku,status:"ERROR",
     error:e instanceof Error?e.message:"operation_failed"});
   // Stop after first failure to avoid further partial batch writes.
   break;
  }
 }
 let historyWarning:string|null=null;
 if(process.env.CATALOG_HUB_LOCAL_MODE!=="true"&&state.supplierId&&state.sourceDate){
   try{
     await hubFetch("/v1/price-import/history",{method:"POST",body:JSON.stringify({
       organizationId,supplierId:state.supplierId,filename:state.fileName,sourceDate:state.sourceDate,
       rows:results.map(row=>({rowNumber:row.rowNumber,sku:row.sku,status:row.status,
         ...(row.status==="STAGED"?{changeSetId:row.id}:{productId:row.id}),error:row.error})),
     })});
   }catch(e){console.error("price_import_history_failed",e);
     historyWarning="Результат применения не сохранился в истории импорта.";}
 }
 if(process.env.CATALOG_HUB_LOCAL_MODE==="true"){
   try{
     await recordLocalImportEvent({
       organizationId,profileId:state.profileId,
       sourceDate:state.sourceDate,
       fileName:state.fileName,format:table.format,action:"APPLY",
       result:results.some(r=>r.status==="ERROR")?"PARTIAL":"COMPLETED",
       totalRows:review.length,countByStatus:counts,
       selectedRows:candidates.length,snapshot:state.snapshot,
     });
   }catch(e){console.error("local_import_history_failed",e);
     historyWarning="Результат применения не сохранился в локальной истории.";}
 }
 return NextResponse.json({
   results,partial:results.some(r=>r.status==="ERROR"),historyWarning,
   reminder:"Повышения с подтверждённым SKU и поставщиком применены. Спорные изменения ожидают проверки. Новые товары созданы с нулевым остатком."
 },{headers:{"cache-control":"no-store"}});
}
