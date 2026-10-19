/**
 * PDF supplier import (text layer only). Product booklets use price-anchored
 * cards; Angiopharm uses a name / package / price table.
 *
 * Every PDF has an unknown commercial interpretation. Prices remain "Цена 1"
 * and "Цена 2"; there is never a guessed SKU, barcode, margin or stock value.
 * No OCR, network calls, or PDF image rendering occur.
 */
import {extractAngiopharmTablePage,isAngiopharmTable} from "./pdf-angiopharm";
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
const MAX_PAGES=30,MAX_ROWS=400;
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
 const matched=text.match(/об[ъь]?[её][мm]\s*:\s*(\d{1,4})\s*(мл|шт|уп|г)(?=$|[\s.,;])/iu);
 return matched?matched[1]+" "+matched[2]:"";
}
function isTitleContinuation(first:string,candidate:string){
 if(candidate.length>55||/^(?:об[ъь]?[её][мm]|цена)/iu.test(candidate))return false;
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
  const desc=normalized(body.replace(/об[ъь]?[её][мm]\s*:\s*\d{1,4}\s*(?:мл|шт|уп|г)(?=$|[\s.,;])/giu,""))
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
/**
 * JeuDerm cards do not always fall strictly inside the upper/lower bands.
 * Detect every price anchor independently within each of three columns.
 * This adapts ProCosmetics' per-column, price-anchored strategy and retains
 * Catalog Hub's explicit SKU and price-role confirmation.
 */
export function extractJeudermCardPage(
 fragments:PdfTextFragment[],pageNo:number,width:number,height:number,
):PdfSupplierRow[]{
 const columns:PdfTextFragment[][]=Array.from({length:3},()=>[]);
 for(const fragment of fragments){
   // Booklet header at y≈140 (A4) is not a product title.
   // Last page's single card begins around y≈180, so keep >=19.5%.
   if(fragment.y<height*0.195||fragment.y>height*0.965)continue;
   // JeuDerm's right column can start at x=395 on an A4 (595pt) page:
   // plain width/3 would misclassify its price as part of the middle column.
   const col=fragment.x<width*0.32?0:fragment.x<width*0.64?1:2;
   columns[col].push(fragment);
 }
 const found:Array<{col:number;top:number;row:PdfSupplierRow}>=[];
 columns.forEach((fragments,col)=>{
   const lines=sortLines(fragments);
   let before:Array<{y:number;text:string}>=[];
   for(let i=0;i<lines.length;i++){
     const current=lines[i];
     if(!/цена\s*[:：]/iu.test(current.text)){
       if(!/^г\.\s*(астана|алматы)/iu.test(current.text)&&
          !/^\+?7[\d\s()-]{7,}$/u.test(current.text)&&
          !/^биотехнологиях из кореи\.?$/iu.test(current.text)&&
          !/^профессиональный медицинский уход/u.test(current.text.toLowerCase()))
         before.push(current);
       continue;
     }
     let priceText=current.text.slice(current.text.search(/цена\s*[:：]/iu));
     const next=lines[i+1];
     let supplemental="";
     // JeuDerm page 7 splits the price across a line with pack volume,
     // e.g. "Цена: 15 700/" followed by "Объем:110 мл 22 700".
     // Some layouts keep the volume *inside* the price line.
     const withoutVolume=(text:string)=>text.replace(
       /об[ъь]?[её][мm]\s*:\s*\d{1,4}\s*(?:млг|мл|шт|уп|гр?|г)?/giu," "
     );
     let [price1,price2]=amounts(withoutVolume(priceText));
     if(!price2&&priceText.includes("/")&&next&&
        (/^\s*[\d\s]{3,14}\s*$/u.test(next.text)||
         /^об[ъь]?[её][мm]\s*:/iu.test(next.text))){
       supplemental=next.text;
       priceText+=" "+supplemental;
       [price1,price2]=amounts(withoutVolume(priceText));
       i++;
     }
     const candidate=before.filter(l=>l.text.length>=2&&
       !/^[-+()\d\s]{10,}$/.test(l.text)&&
       !/^(каталог|jeuderm|оглавление)$/iu.test(l.text));
     before=[];
     if(!price1||!candidate.length)continue;
     const titleParts=[candidate[0].text];
     let end=0;
     if(candidate.length>1&&candidate[1].y-candidate[0].y<23&&
        isTitleContinuation(candidate[0].text,candidate[1].text)){
       titleParts.push(candidate[1].text);end=1;
     }
     const title=normalized(titleParts.join(" ")).slice(0,220);
     if(title.length<4||/^(цена|объем|каталог|г\.)/iu.test(title))continue;
     const body=candidate.slice(end+1).map(row=>row.text).join(" ");
     const volume=volumeOf([body,current.text,supplemental].join(" "));
     const variantTitle=volume&&!title.toLowerCase().includes(volume.toLowerCase())
       ?title+" ("+volume+")":title;
     const desc=normalized(body.replace(/об[ъь]?[её][мm]\s*:\s*\d{1,4}\s*(?:мл|шт|уп|г)(?=$|[\s.,;])/giu,""))
       .slice(0,2800);
     found.push({col,top:candidate[0].y,row:{
       "Артикул":"","Наименование":variantTitle,
       "Описание":normalized((volume?"Объем: "+volume+". ":"")+desc),
       "Объем":volume,"Цена 1":price1,"Цена 2":price2,"Страница":String(pageNo),
     }});
   }
 });
 // Document's visual reading order, independent of PDF stream ordering.
 return found.sort((a,b)=>a.top-b.top||a.col-b.col).map(x=>x.row);
}
export async function parsePdfSupplier(bytes:Uint8Array,options:{fileName?:string}={}):Promise<PdfSupplierResult>{
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
  const specialized=/jeu\s*d[eé]rm|жеудерм/i.test(options.fileName||"");
  let angiopharm=/ангиофарм|angiopharm/i.test(options.fileName||"");
  let totalPriceAnchors=0;
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
   if(pageNum===1&&!angiopharm)angiopharm=isAngiopharmTable(fragments);
   const priceCount=fragments.filter(x=>/цена\s*[:：]/iu.test(x.text)).length;
   totalPriceAnchors+=priceCount;
   const rows=angiopharm
      ?extractAngiopharmTablePage(fragments,pageNum,viewport.width)
      :specialized?extractJeudermCardPage(fragments,pageNum,viewport.width,viewport.height)
      :extractPdfCardPage(fragments,pageNum,viewport.width,viewport.height);
   if(!angiopharm&&priceCount>rows.length)warnings.push(
     "Страница "+pageNum+": обнаружено цен "+priceCount+", карточек "+rows.length+
     ". Проверьте пропущенный товар на этой странице."
   );
   result.push(...rows);
   page.cleanup();
   if(result.length>MAX_ROWS)throw new Error("pdf_too_many_cards_max_400");
  }
  if(result.length===0){
   if(emptyTextPages>=Math.ceil(pdf.numPages/2))throw new Error("pdf_scanned_or_image_only_ocr_required");
   throw new Error(angiopharm?"pdf_table_layout_not_detected: строки с названием, объёмом и ценой не найдены":
     "pdf_card_layout_not_detected: ожидаются карточки с названием и строкой «Цена:»");
  }
  if(emptyTextPages>0)warnings.push("Без текстового слоя: "+emptyTextPages+" стр. Нужен OCR для полного результата.");
  if(!angiopharm&&totalPriceAnchors>result.length)warnings.push(
    "Не все цены связаны с карточками: найдено строк «Цена:» "+
    totalPriceAnchors+", распознано карточек "+result.length+
    ". Нужна ручная проверка пропущенных позиций."
  );
  if(specialized)warnings.push("Парсер: JeuDerm — анализ карточек по колонкам и строкам цен.");
  if(angiopharm){
   const missing=result.filter(row=>!row["Артикул"]).length;
   if(missing)warnings.push("Без артикула: "+missing+" строк. Укажите внутренний SKU для новых товаров вручную.");
   warnings.push("Колонка «Цена, тг.» сохранена как «Цена 1»: подтвердите её роль перед импортом.");
  }else{
   warnings.push("PDF не содержит подтверждённых артикулов: введите SKU вручную перед созданием новых товаров.");
   warnings.push("Колонки «Цена 1» и «Цена 2» сохранены: проверьте их назначение в сопоставлении перед импортом.");
  }
  warnings.push("Автоматическое изменение складских остатков из PDF отключено.");
  return {format:"PDF",headers:angiopharm?[...HEADERS,"Бренд"]:HEADERS,rows:result,pageCount:pdf.numPages,warnings,needsManualSku:true};
 }finally{if(pdf)await pdf.destroy();else await task.destroy();}
}
