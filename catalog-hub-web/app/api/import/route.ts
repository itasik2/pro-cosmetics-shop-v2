import { NextRequest,NextResponse } from "next/server";
import {createHmac,createHash,timingSafeEqual} from "node:crypto";
import {hubFetch,organizationId} from "@/lib/hub";
import {parseTable,mapImport,autoMapping} from "@/lib/import-parser";
import {type Mapping,type Field} from "@/lib/import-types";
import {evaluateImport,type Existing} from "@/lib/import-review";
import {isLocalReadOnly} from "@/lib/local-mode";
import {isSameOrigin} from "@/lib/same-origin";
import {listSupplierProfiles,recordLocalImportEvent} from "@/lib/local-supplier-store";
import {buildUniversalCatalog} from "@/lib/universal-catalog";

export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=60;

type Catalog={items:Existing[];total:number};
type Categories={categories:Array<{key:string;isActive:boolean}>};
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
function digest(fileDigest:string,mapping:Mapping,review:ReturnType<typeof evaluateImport>){
 const data=JSON.stringify({
   org:organizationId,fileDigest,mapping,
   rows:review.map(x=>[x.rowNumber,x.sku,x.barcode,x.productId,x.status,x.currentUpdatedAt,x.proposed,x.changes])
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
 if(!(file instanceof File))throw new Error("file_required");
 const table=await parseTable(file);
 const originalRows=table.rows.map(row=>({...row}));
 const skuOverrideRaw=data.get("skuOverrides");
 if(skuOverrideRaw){
   if(table.format!=="PDF"||typeof skuOverrideRaw!=="string"||skuOverrideRaw.length>25000)
     throw new Error("invalid_pdf_sku_overrides");
   let overrides:unknown;
   try{overrides=JSON.parse(skuOverrideRaw)}catch{throw new Error("invalid_pdf_sku_overrides");}
   if(!overrides||typeof overrides!=="object"||Array.isArray(overrides)||
       Object.keys(overrides).length>table.rows.length)throw new Error("invalid_pdf_sku_overrides");
   for(const [index,value] of Object.entries(overrides)){
     const number=Number(index);
     if(!/^\d+$/.test(index)||!Number.isSafeInteger(number)||number>=table.rows.length||
         typeof value!=="string"||value.length>100||
         (value.trim()!==""&&!/^[\p{L}\p{N}][\p{L}\p{N}_.\/-]*$/u.test(value.trim())))
       throw new Error("invalid_pdf_sku_overrides");
     table.rows[number]["Артикул"]=value.trim();
   }
 }
 const mapping=mappingFrom(data.get("mapping"),table.headers);
 const items=mapImport(table,mapping);
 // PDF booklets have two unlabeled commercial amounts. Require an explicit
 // retail-price column choice; never create an unpriced or guessed-price card.
 if(table.format==="PDF"){
   for(const item of items){
     if(!mapping.price)item.errors.push("PDF: выберите розничную цену (Цена 1 или Цена 2) в сопоставлении колонок");
     else if(item.price===undefined)item.errors.push("PDF: выбранная колонка розничной цены пуста");
   }
 }
 const [snapshot,categories]=await Promise.all([
   hubFetch<Catalog>("/v1/catalog/snapshot?organizationId="+encodeURIComponent(organizationId)),
   hubFetch<Categories>("/v1/categories?organizationId="+encodeURIComponent(organizationId)),
 ]);
 const review=evaluateImport(items,snapshot.items,categories.categories.filter(c=>c.isActive).map(c=>c.key));
 const hash=await fileHash(file);
 const universalCatalog=buildUniversalCatalog({fileName:file.name,fileSha256:hash,table,mapping,items,review,originalRows});
 for(const row of universalCatalog.products){
   if(row.identity.productId){
     row.identity.internalSku=snapshot.items.find(p=>p.id===row.identity.productId)?.sku||row.identity.internalSku;
   }
 }
 const sourceBase=createHash("sha256").update(hash+JSON.stringify(mapping)).digest("hex").slice(0,32);
 let profileId:string|null=null;
 if(process.env.CATALOG_HUB_LOCAL_MODE==="true"){
   const requested=data.get("profileId");
   if(typeof requested==="string"&&requested){
     const profiles=await listSupplierProfiles(organizationId);
     if(!profiles.some(p=>p.id===requested))throw new Error("supplier_profile_not_found");
     profileId=requested;
   }
 }
 return {data,file,table,mapping,review,sourceBase,profileId,universalCatalog,fingerprint:digest(hash,mapping,review)};
}
export async function POST(request:NextRequest) {
 if(!isSameOrigin(request))return responseError("invalid_origin",403);
 let state:Awaited<ReturnType<typeof prepare>>;
 try{state=await prepare(request);}
 catch(e){const msg=e instanceof Error?e.message:"import_preview_failed";
   return responseError(msg,/too_large|size_limit|too_many/.test(msg)?413:400);}
 const {data,table,mapping,review,fingerprint}=state;
 const action=data.get("action")==="apply"?"apply":"preview";
 const counts=Object.fromEntries(["CREATE","UPDATE","SAME","INVALID","CONFLICT","DUPLICATE"].map(s=>
    [s,review.filter(r=>r.status===s).length]));
 if(action==="preview"){
   if(process.env.CATALOG_HUB_LOCAL_MODE==="true"){
     try{
       await recordLocalImportEvent({
         organizationId,profileId:state.profileId,
         fileName:state.file.name,format:table.format,action:"PREVIEW",
         result:"PREVIEWED",totalRows:review.length,countByStatus:counts,
         selectedRows:0,
       });
     }catch(e){console.error("local_import_history_failed",e);}
   }
   return NextResponse.json({
     format:table.format,headers:table.headers,mapping,review,counts,fingerprint,
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
     note:"Stock fields are informational; source files are not stored. Existing products are staged for review, new products require explicit confirmation."
   },{headers:{"cache-control":"no-store"}});
 }
 if(data.get("confirmed")!=="yes")return responseError("confirmation_required");
 if(isLocalReadOnly())return responseError("local_read_only_mode: сохранение товаров отключено до подключения тестовой базы.",403);
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
 if(candidates.some(r=>!["CREATE","UPDATE"].includes(r.status)))return responseError("selection_has_conflicts",409);
 const results:Array<{rowNumber:number;sku:string;status:string;id?:string;error?:string}>=[];
 for(const item of candidates){
  try{
   if(item.status==="UPDATE"){
     const staged=await hubFetch<{id:string;status:string}>("/v1/staging/changesets",{
       method:"POST",body:JSON.stringify({
         organizationId,productId:item.productId,
         sourceType:"IMPORT",sourceRef:"supplierfile:"+state.sourceBase+":"+item.index,
         proposed:Object.fromEntries(item.changes.map(c=>[c.field,c.after])),
       }),
     });
     results.push({rowNumber:item.rowNumber,sku:item.sku,status:"STAGED",id:staged.id});
   }else{
     // No stock is created, even when the supplier file contains a quantity.
     const created=await hubFetch<{id:string}>("/v1/catalog/products",{
       method:"POST",body:JSON.stringify({
         organizationId,card:{
           sku:item.sku,title:item.title,
           attributes:{
             ...(state.universalCatalog.products[item.index].card.variant?{
               volumeValue:state.universalCatalog.products[item.index].card.variant!.value,
               volumeUnit:state.universalCatalog.products[item.index].card.variant!.unit,
             }:{}),
             supplierImport:{
               ...state.universalCatalog.source,
               ...state.universalCatalog.products[item.index].provenance,
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
 if(process.env.CATALOG_HUB_LOCAL_MODE==="true"){
   try{
     await recordLocalImportEvent({
       organizationId,profileId:state.profileId,
       fileName:state.file.name,format:table.format,action:"APPLY",
       result:results.some(r=>r.status==="ERROR")?"PARTIAL":"COMPLETED",
       totalRows:review.length,countByStatus:counts,
       selectedRows:candidates.length,
     });
   }catch(e){console.error("local_import_history_failed",e);}
 }
 return NextResponse.json({
   results,partial:results.some(r=>r.status==="ERROR"),
   reminder:"STAGED means saved to Changes for manual approval. CREATED means a new product was created with zero stock."
 },{headers:{"cache-control":"no-store"}});
}
