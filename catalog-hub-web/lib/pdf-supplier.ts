/**
 * PDF supplier booklet import (text layer only). Conservative extraction:
 * six cards per A4 page, three columns, up to two rows.
 *
 * Every PDF has an unknown commercial interpretation. Prices remain "Цена 1"
 * and "Цена 2"; there is never a guessed SKU, barcode, margin or stock value.
 * No OCR, network calls, or PDF image rendering occur.
 */
export type PdfTextFragment = {text:string;x:number;y:number};
export type PdfSupplierRow = {
  "Артикул":string;
  "Наименование":string;
  "Описание":string;
  "Объем":string;
  "Цена 1":string;
  "Цена 2":string;
  "Страница":string;
};
export type PdfSupplierResult = {
  format:"PDF";
  headers:string[];
  rows:Array<Record<string,string>>;
  pageCount:number;
  warnings:string[];
  needsManualSku:true;
};
const HEADERS=["Артикул","Наименование","Описание","Объем","Цена 1","Цена 2","Страница"];
const MAX_PDF_SIZE=8*1024*1024;
const MAX_PAGES=30,MAX_ROWS=200;
function normalized(text:string){return text.replace(/\s+/g," ").replace(/\u0000/g,"").trim();}
function sortLines(fragments:PdfTextFragment[]){
  const lines:Array<{y:number;parts:PdfTextFragment[]}>= [];
  for(const fragment of [...fragments].sort((a,b)=>a.y-b.y||a.x-b.x)){
    const last=lines[lines.length-1];
    if(last&&Math.abs(fragment.y-last.y)<3.8){
      last.parts.push(fragment);
      last.y=(last.y*(last.parts.length-1)+fragment.y)/last.parts.length;
    }else lines.push({y:fragment.y,parts:[fragment]});
  }
  return lines.map(l=>({y:l.y,text:normalized(l.parts.sort((a,b)=>a.x-b.x).map(p=>p.text).join(" "))}))
    .filter(l=>l.text);
}
function amounts(text:string):[string,string]{
  const cleaned=text.replace(/^.*?\bцена\s*[:：]?\s*/iu,"").trim();
  const parts=cleaned.split("/").map(chunk=>chunk.replace(/[^\d]/g,"")).filter(Boolean);
  const valid=(part:string)=>/^\d{3,8}$/.test(part)?part:"";
  return [valid(parts[0]||""),valid(parts[1]||"")];
}
function volumeOf(text:string){
 const matched=text.match(/об[ъь]?е[мm]\s*:\s*(\d{1,4})\s*(мл|шт|уп|г)(?=$|[\s.,;])/iu);
 return matched?matched[1]+" "+matched[2]:"";
}
function isTitleContinuation(first:string,candidate:string){
 if(candidate.length>55||/^(?:об[ъь]?е[мm]|цена)/iu.test(candidate))return false;
 // For cards headed "AcnoCell Treatment" and the next bold line "Emulsion".
 if(!/[\p{Script=Latin}]/u.test(first))return false;
 if(/[\p{Script=Cyrillic}]/u.test(candidate))return false;
 return /^[\p{Script=Latin}\d\- .()]+$/u.test(candidate);
}
export function extractPdfCardPage(
 fragments:PdfTextFragment[],pageNo:number,width:number,height:number,
):PdfSupplierRow[]{
 const bands:PdfTextFragment[][]=Array.from({length:6},()=>[]);
 for(const fragment of fragments){
  // Some supplier booklets place bottom-row prices as low as 94% of page height.
  // Page footers are ignored because we stop each card at its first price anchor.
  if(fragment.y<height*0.17||fragment.y>height*0.965)continue;
  const col=Math.max(0,Math.min(2,Math.floor(fragment.x/(width/3))));
  const row=fragment.y<height*0.60?0:1;
  bands[row*3+col].push(fragment);
 }
 const found:PdfSupplierRow[]=[];
 for(const cell of bands){
  const lines=sortLines(cell);
  const priceIdx=lines.findIndex(l=>/^цена\s*[:：]/iu.test(l.text));
  if(priceIdx<1)continue;
  const [price1,price2]=amounts(lines[priceIdx].text);
  if(!price1&&!price2)continue;
  // Price labels may be in the middle of a page, while unrelated footer text
  // falls after them. Never extract below the first valid price anchor.
  const before=lines.slice(0,priceIdx)
    .filter(line=>!/^[-+()\d\s]{10,}$/.test(line.text))
    .filter(line=>!/^г\.\s*(астана|алматы)/iu.test(line.text));
  if(!before.length)continue;
  const titleParts=[before[0].text];
  let titleEnd=0;
  if(before.length>1&&before[1].y-before[0].y<22 &&
    isTitleContinuation(before[0].text,before[1].text)){
    titleParts.push(before[1].text);titleEnd=1;
  }
  const title=normalized(titleParts.join(" ")).slice(0,220);
  // Cards without credible product titles should not become import rows.
  if(title.length<4||/^(цена|объем|каталог|г\.)/iu.test(title))continue;
  const body=before.slice(titleEnd+1).map(line=>line.text).join(" ");
  const volume=volumeOf(body);
  // Packaging size is part of a sellable variant, not merely a description.
  // Never combine "ReformAge O2 Fluid 50 мл" with "110 мл" into one card.
  const variantTitle=volume&&!title.toLowerCase().includes(volume.toLowerCase())
    ?title+" ("+volume+")":title;
  const desc=normalized(body.replace(/об[ъь]?е[мm]\s*:\s*\d{1,4}\s*(?:мл|шт|уп|г)(?=$|[\s.,;])/giu,""))
    .slice(0,2800);
  found.push({
   "Артикул":"",
   "Наименование":variantTitle,
   "Описание":normalized((volume?"Объем: "+volume+". ":"")+desc),
   "Объем":volume,
   "Цена 1":price1,
   "Цена 2":price2,
   "Страница":String(pageNo),
  });
 }
 return found;
}
export async function parsePdfSupplier(bytes:Uint8Array):Promise<PdfSupplierResult>{
 if(bytes.byteLength<20||bytes.byteLength>MAX_PDF_SIZE)throw new Error("pdf_file_size_limit_8mb");
 if(new TextDecoder().decode(bytes.subarray(0,8)).indexOf("%PDF-")<0)
  throw new Error("invalid_pdf_signature");
 const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
 const task=pdfjs.getDocument({
   data:bytes,
   isEvalSupported:false,
   useSystemFonts:true,
   verbosity:0,
 });
 let pdf:Awaited<typeof task.promise>|undefined;
 try{
  pdf=await task.promise;
  if(pdf.numPages>MAX_PAGES)throw new Error("pdf_too_many_pages_max_30");
  const result:PdfSupplierRow[]=[];
  let emptyTextPages=0;
  const warnings:string[]=[];
  for(let pageNum=1;pageNum<=pdf.numPages;pageNum++){
   const page=await pdf.getPage(pageNum);
   const viewport=page.getViewport({scale:1});
   const content=await page.getTextContent();
   const fragments:PdfTextFragment[]=[];
   for(const item of content.items){
     if(!("str" in item)||typeof item.str!=="string"||!Array.isArray(item.transform))continue;
     const value=normalized(item.str);
     if(!value)continue;
     fragments.push({text:value,x:item.transform[4],y:viewport.height-item.transform[5]});
   }
   if(fragments.reduce((sum,x)=>sum+x.text.length,0)<30)emptyTextPages++;
   result.push(...extractPdfCardPage(fragments,pageNum,viewport.width,viewport.height));
   page.cleanup();
   if(result.length>MAX_ROWS)throw new Error("pdf_too_many_cards_max_200");
  }
  if(result.length===0){
   if(emptyTextPages>=Math.ceil(pdf.numPages/2))throw new Error("pdf_scanned_or_image_only_ocr_required");
   throw new Error("pdf_card_layout_not_detected: ожидаются карточки с названием и строкой «Цена:»");
  }
  if(emptyTextPages>0)warnings.push("Без текстового слоя: "+emptyTextPages+" стр. Нужен OCR для полного результата.");
  warnings.push("PDF не содержит подтверждённых артикулов: введите SKU вручную перед созданием новых товаров.");
  warnings.push("Цена 1 и Цена 2 оставлены без назначения: выберите нужную колонку для закупочной/розничной цены.");
  warnings.push("Автоматическое изменение складских остатков из PDF отключено.");
  return {format:"PDF",headers:HEADERS,rows:result,pageCount:pdf.numPages,warnings,needsManualSku:true};
 }finally{if(pdf)await pdf.destroy();else await task.destroy();}
}
