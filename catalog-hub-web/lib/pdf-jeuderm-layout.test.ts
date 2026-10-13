import test from "node:test";
import assert from "node:assert/strict";
import {extractJeudermCardPage,type PdfTextFragment} from "./pdf-supplier";
const a=(text:string,x:number,y:number):PdfTextFragment=>({text,x,y});

test("specialized JeuDerm parser finds all 6 items even when upper/lower boundaries vary",()=>{
 const fragments:PdfTextFragment[]=[];
 for(let col=0;col<3;col++){
   const x=25+col*190;
   for(let row=0;row<2;row++){
     const y=row?520:215;
     fragments.push(
      a("Test Jeuderm Serum "+(col*2+row),x,y),
      a("Описание увлажнения",x,y+28),
      a("Объем: "+(30+col*2+row)+" мл",x,y+65),
      a("Цена: 18 700 / 28 000",x,y+165),
     );
   }
 }
 const rows=extractJeudermCardPage(fragments,1,595,843);
 assert.equal(rows.length,6);
 assert.ok(rows.every(r=>r["Цена 1"]==="18700"&&r["Цена 2"]==="28000"));
 assert.deepEqual(new Set(rows.map(r=>r["Объем"])).size,6);
});
test("JeuDerm price wrapped onto its own numeric line can be parsed",()=>{
 const rows=extractJeudermCardPage([
  a("My Ato Special Gel",29,230),
  a("Объем: 200 мл",29,340),
  a("Цена: 15 700/",29,430),
  a("23 550",29,447),
 ],1,595,843);
 assert.equal(rows.length,1);
 assert.equal(rows[0]["Цена 1"],"15700");
 assert.equal(rows[0]["Цена 2"],"23550");
 assert.equal(rows[0]["Наименование"],"My Ato Special Gel (200 мл)");
});
test("JeuDerm right-column text at x395 is not allocated to middle column",()=>{
 const result=extractJeudermCardPage([
  a("Second Column Card",210,200),
  a("Цена: 10 000 / 14 000",212,423),
  a("Third Column Card",401,205),
  a("Цена: 15 000 / 21 700",395,429),
 ],6,595,843);
 assert.equal(result.length,2);
 assert.ok(result.some(row=>row["Наименование"]==="Third Column Card"));
});
test("JeuDerm inline price is detected in same baseline as body text",()=>{
 const result=extractJeudermCardPage([
   a("Ala Factor Energo Emulsion",401,263),
   a("Описание продукта",400,405),
   a("кожи. Цена: 15 700/",400,425),
   a("22 700",475,438),
 ],7,595,843);
 assert.equal(result.length,1);
 assert.equal(result[0]["Цена 1"],"15700");
 assert.equal(result[0]["Цена 2"],"22700");
});
test("JeuDerm specialist ignores document title and still reads final single card",()=>{
 const rows=extractJeudermCardPage([
  a("JeuDerm",220,120),
  a("ReformAge Final Serum",211,245),
  a("Объем: 100 мл",211,270),
  a("Цена: 9200 / 14 500",211,305),
 ],11,595,843);
 assert.equal(rows.length,1);
 assert.equal(rows[0]["Цена 1"],"9200");
 assert.equal(rows[0]["Страница"],"11");
});

test("publisher header fragments never become a product title",()=>{
 const rows=extractJeudermCardPage([
  a("биотехнологиях из Кореи.",246,138),
  a("My Ato Clean Gel",220,300),
  a("Объем: 250 мл",222,380),
  a("Цена: 13 500 / 20 250",221,448),
 ],1,595,843);
 assert.equal(rows.length,1);
 assert.equal(rows[0]["Наименование"],"My Ato Clean Gel (250 мл)");
 assert.equal(rows[0]["Цена 2"],"20250");
});
test("JeuDerm volume embedded BETWEEN prices is not interpreted as part of retail amount",()=>{
 const rows=extractJeudermCardPage([
  a("Ala Factor Energo Emulsion",403,273),
  a("Описание эмульсии",403,374),
  a("Цена: 15 700/ Объем:110 мл 22 700",403,435),
 ],7,595,843);
 assert.equal(rows.length,1);
 assert.equal(rows[0]["Цена 1"],"15700");
 assert.equal(rows[0]["Цена 2"],"22700");
 assert.equal(rows[0]["Объем"],"110 мл");
});
test("JeuDerm volume in next line is preserved and second price parsed",()=>{
 const rows=extractJeudermCardPage([
  a("Ala Factor Energo Emulsion",403,273),
  a("Описание эмульсии",403,374),
  a("Цена: 15 700/",403,435),
  a("Объем:110 мл 22 700",403,453),
 ],7,595,843);
 assert.equal(rows.length,1);
 assert.equal(rows[0]["Цена 2"],"22700");
 assert.equal(rows[0]["Объем"],"110 мл");
});
