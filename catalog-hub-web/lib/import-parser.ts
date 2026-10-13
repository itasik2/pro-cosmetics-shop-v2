import "server-only";
import { readSheet } from "read-excel-file/node";
import { XMLParser, XMLValidator } from "fast-xml-parser";

import {type Field,type Mapping} from "./import-types";
import {parsePdfSupplier} from "./pdf-supplier";
export type Table = { headers:string[];rows:Array<Record<string,string>>;format:string;
  warnings?:string[];pageCount?:number;needsManualSku?:boolean };
export type ImportItem = {
 rowNumber:number;sku:string;barcode:string;title:string;brand?:string;
 purchasePrice?:number;price?:number;description?:string;categoryKey?:string;
 stock?:number;errors:string[];
};
const MAX_BYTES=2*1024*1024, MAX_ROWS=200, MAX_COLS=50;

function stringify(value:unknown):string {
 if(value==null) return "";
 if(typeof value==="string"||typeof value==="number"||typeof value==="boolean")return String(value);
 if(typeof value==="object" && value!==null && "#text" in value)return stringify((value as Record<string,unknown>)["#text"]);
 return "";
}
function tabular(header:string[], rows:unknown[][],format:string):Table {
 if(header.length>MAX_COLS)throw new Error("too_many_columns");
 const seen=new Set<string>();
 const headers=header.map((name,i)=>{
   const key=name.trim().slice(0,120)||"Column "+(i+1);
   if(seen.has(key))throw new Error("duplicate_column:"+key);
   seen.add(key);return key;
 });
 const filtered=rows.filter(row=>Array.isArray(row)&&row.some(v=>stringify(v).trim()!==""));
 if(filtered.length>MAX_ROWS)throw new Error("too_many_rows_max_200");
 return {headers,format,rows:filtered.map(row=>Object.fromEntries(headers.map((key,i)=>[key,stringify(row[i]).trim().slice(0,6000)])))};
}
function parseDelimited(input:string,delimiter:string):string[][] {
 const rows:string[][]=[];let row:string[]=[],field="",quoted=false;
 const text=input.replace(/^\uFEFF/,"");
 for(let i=0;i<text.length;i++){
   const ch=text[i];
   if(ch==='"'){
     if(quoted&&text[i+1]==='"'){field+='"';i++;}else if(field.length===0||quoted){quoted=!quoted;}else field+=ch;
   }else if(!quoted&&ch===delimiter){row.push(field);field="";}
   else if(!quoted&&(ch==='\n'||ch==='\r')){
     row.push(field);rows.push(row);row=[];field="";
     if(ch==='\r'&&text[i+1]==='\n')i++;
     if(rows.length>MAX_ROWS+2)throw new Error("too_many_rows_max_200");
   }else field+=ch;
   if(field.length>9000)throw new Error("field_too_long");
 }
 if(quoted)throw new Error("unclosed_csv_quote");
 if(field||row.length){row.push(field);rows.push(row);}
 return rows;
}
function findEntries(root:unknown,depth=0):Array<Record<string,unknown>>|null {
 if(depth>5||root==null||typeof root!=="object")return null;
 if(Array.isArray(root)){
   if(root.every(x=>x&&typeof x==="object"&&!Array.isArray(x)))return root as Array<Record<string,unknown>>;
   return null;
 }
 const obj=root as Record<string,unknown>;
 // A supplier XML feed may contain one <offer> instead of an array of offers.
 if(["sku","vendorCode","barcode","name","title","@_id"].some(key=>key in obj)) {
   return [obj];
 }
 for(const key of ["items","products","offers","offer","product","item","rows","row","goods","catalog"]){
   if(key in obj){const candidate=findEntries(obj[key],depth+1);if(candidate)return candidate;}
 }
 for(const value of Object.values(obj)){
   const candidate=findEntries(value,depth+1);if(candidate)return candidate;
 }
 return null;
}
function parseObjects(items:Array<Record<string,unknown>>,format:string):Table {
 if(items.length>MAX_ROWS)throw new Error("too_many_rows_max_200");
 const normalized=items.map(obj=>Object.fromEntries(Object.entries(obj).map(([k,v])=>
   [k.startsWith("@_")?k.slice(2):k,stringify(v)])));
 const headers=[...new Set(normalized.flatMap(o=>Object.keys(o)))];
 if(!headers.length)throw new Error("no_columns");
 return tabular(headers,normalized.map(o=>headers.map(h=>o[h]??"")),format);
}
export async function parseTable(file:File):Promise<Table>{
 const name=file.name.toLowerCase();
 if(name.endsWith(".pdf")){
   const parsed=await parsePdfSupplier(new Uint8Array(await file.arrayBuffer()));
   return parsed;
 }
 if(file.size<1||file.size>MAX_BYTES)throw new Error("file_size_limit_2mb");
 if(name.endsWith(".xlsx")){
   const rows=await readSheet(Buffer.from(await file.arrayBuffer()) as Parameters<typeof readSheet>[0]);
   if(rows.length<2)throw new Error("xlsx_empty");
   if(rows.length>MAX_ROWS+1)throw new Error("too_many_rows_max_200");
   return tabular(rows[0].map(stringify),rows.slice(1),"XLSX");
 }
 const text=await file.text();
 if(name.endsWith(".csv")||name.endsWith(".tsv")){
   const first=text.split(/\r?\n/,1)[0];
   const delimiter=name.endsWith(".tsv")?"\t":
     (first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?";":",";
   const rows=parseDelimited(text,delimiter);
   if(rows.length<2)throw new Error("no_data_rows");
   return tabular(rows[0],rows.slice(1),name.endsWith(".tsv")?"TSV":"CSV");
 }
 if(name.endsWith(".json")){
   const value:unknown=JSON.parse(text);
   const items=findEntries(value);
   if(!items)throw new Error("json_products_not_found");
   return parseObjects(items,"JSON");
 }
 if(name.endsWith(".xml")||name.endsWith(".yml")){
   if(XMLValidator.validate(text)!==true)throw new Error("invalid_xml");
   const tree=new XMLParser({ignoreAttributes:false,attributeNamePrefix:"@_",parseTagValue:false,
     parseAttributeValue:false,processEntities:false,trimValues:true}).parse(text);
   const rows=findEntries(tree);
   if(!rows)throw new Error("xml_products_not_found");
   return parseObjects(rows,"XML");
 }
 throw new Error("unsupported_format_use_pdf_xlsx_csv_tsv_xml_yml_json");
}

const aliases:Record<Field,string[]>={
 sku:["sku","артикул","код товара","supplier sku","seller sku","vendorcode","code","id","offerid"],
 barcode:["barcode","штрихкод","штрих код","ean","ean13","gtin"],
 title:["title","название","наименование","товар","product name","name"],
 brand:["brand","бренд","марка","vendor","manufacturer","производитель"],
 purchasePrice:["закупочная цена","себестоимость","purchaseprice","cost","закупка","оптовая цена"],
 price:["розничная цена","цена","price","retail","retail price","sellingprice"],
 description:["описание","description","descr"],
 categoryKey:["категория","category","categorykey"],
 stock:["остаток","количество","stock","quantity","qty"],
};
const clean=(s:string)=>s.trim().toLowerCase().replace(/[\s_–-]+/g," ");
export function autoMapping(headers:string[]):Mapping{
 const result:Mapping={};
 for(const key of Object.keys(aliases) as Field[]){
   const index=headers.findIndex(h=>aliases[key].some(alias=>clean(alias)===clean(h)));
   if(index!==-1)result[key]=headers[index];
 }
 return result;
}
function parseMoney(raw:string,label:string,errors:string[]):number|undefined{
 if(!raw.trim())return undefined;
 const cleaned=raw.trim().replace(/[ ₸\u00a0\u202f]/g,"").replace(/^\uFEFF/,"");
 const value=cleaned.replace(/,00$/, "").replace(/\.00$/,"");
 if(!/^\d{1,9}$/.test(value)){errors.push("Неверное целое значение: "+label);return undefined;}
 return Number(value);
}
export function mapImport(table:Table,mapping:Mapping):ImportItem[]{
 for(const v of Object.values(mapping)){if(v&& !table.headers.includes(v))throw new Error("mapping_column_unknown");}
 return table.rows.map((row,i)=>{
   const field=(f:Field)=>mapping[f]?String(row[mapping[f]!]||"").trim():"";
   const errors:string[]=[];
   const sku=field("sku").slice(0,120),barcode=field("barcode").slice(0,120),
    title=field("title").slice(0,500);
   if(!sku&&!barcode)errors.push("Нужен SKU или штрихкод");
   if(sku.length>100)errors.push("Слишком длинный SKU");
   const purchasePrice=parseMoney(field("purchasePrice"),"закупочная цена",errors);
   const price=parseMoney(field("price"),"розничная цена",errors);
   const stock=parseMoney(field("stock"),"остаток",errors);
   if(price===0)errors.push("Розничная цена должна быть положительной");
   return {rowNumber:i+2,sku,barcode,title,
     brand:field("brand")||undefined,description:field("description")||undefined,
     categoryKey:field("categoryKey")||undefined,purchasePrice,price,stock,errors};
 });
}
