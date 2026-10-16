/**
 * Draft INTERNAL SKU labels for PDF catalogues without supplier identifiers.
 * The output is a proposal for human review, not an invented supplier article.
 * Deterministic for same prefix + normalized title (including pack volume).
 * Duplicate products get duplicate labels and are blocked by import-review.
 */
export type PdfDraftRow={index:number;title:string;sku:string};
const normalize=(s:string)=>s.normalize("NFKD").toUpperCase()
  .replace(/[\u0300-\u036f]/g,"")
  .replace(/\s+/g," ").trim();
function fnv32(text:string):string{
 let h=0x811c9dc5;
 const encoded=new TextEncoder().encode(text);
 for(const byte of encoded){
  h=Math.imul(h^byte,0x01000193)>>>0;
 }
 return h.toString(16).padStart(8,"0").toUpperCase();
}
export function validPrefix(prefix:string):boolean{
 return /^[A-Z0-9]{2,12}$/.test(prefix.toUpperCase());
}
export function draftInternalSku(prefix:string,title:string):string{
 if(!validPrefix(prefix))throw new Error("sku_prefix_invalid");
 const canonical=normalize(title);
 if(canonical.length<4)throw new Error("sku_title_missing");
 const ascii=canonical.replace(/[^A-Z0-9]+/g,"-").replace(/^-|-$/g,"");
 const slug=(ascii||"PRODUCT").slice(0,40).replace(/-$/,"");
 return prefix.toUpperCase()+"-"+slug+"-"+fnv32(canonical);
}
export function draftPdfSkuOverrides(
 rows:PdfDraftRow[],prefix:string,current:Record<number,string>
):Record<number,string>{
 if(!validPrefix(prefix))throw new Error("sku_prefix_invalid");
 const suggestions:Record<number,string>={...current};
 for(const row of rows){
  if(!row.sku&&!current[row.index]?.trim()&&row.title?.trim().length>=4){
   suggestions[row.index]=draftInternalSku(prefix,row.title);
  }
 }
 return suggestions;
}
export function countDuplicateSkuDrafts(skus:Record<number,string>):number{
 const values=Object.values(skus).filter(s=>s.trim()).map(s=>s.toUpperCase());
 return values.length-new Set(values).size;
}


export function duplicatePdfSkuGroups(rows:PdfDraftRow[],skus:Record<number,string>){
 const candidates=new Map<string,Array<{index:number;title:string}>>();
 for(const row of rows){
   const sku=(skus[row.index]||row.sku||"").trim().toUpperCase();
   if(!sku)continue;
   const previous=candidates.get(sku)||[];
   previous.push({index:row.index,title:row.title});
   candidates.set(sku,previous);
 }
 return [...candidates.entries()].filter(([,duplicates])=>duplicates.length>1)
   .map(([sku,items])=>({sku,items}));
}
