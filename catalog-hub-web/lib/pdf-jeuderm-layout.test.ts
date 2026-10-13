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
