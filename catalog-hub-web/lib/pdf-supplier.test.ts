import test from "node:test";
import assert from "node:assert/strict";
import {extractPdfCardPage,parsePdfSupplier,type PdfTextFragment} from "./pdf-supplier";

function a(text:string,x:number,y:number):PdfTextFragment{return {text,x,y};}
test("extracts two separate prices from a three-column product booklet without guessing SKU",()=>{
 const fragments=[
  a("My Ato Intensive Cream",35,300),
  a("Увлажняющий крем для сухой кожи",35,325),
  a("Объем: 50 мл",35,395),
  a("Цена: 18 700 / 28 000",35,440),
  a("My Ato Clean Gel",225,300),
  a("Очищающий гель",220,324),
  a("Объем: 250 мл",225,395),
  a("Цена: 13 500 / 20 250",225,440),
  a("AcnoCell Treatment",411,300),
  a("Emulsion",440,315),
  a("Объем: 150 мл",411,395),
  a("Цена: 16 800 / 24 300",411,440),
 ];
 const rows=extractPdfCardPage(fragments,1,595,843);
 assert.equal(rows.length,3);
 assert.deepEqual(rows.map(x=>x["Артикул"]),["","",""]);
 assert.equal(rows[0]["Наименование"],"My Ato Intensive Cream (50 мл)");
 assert.equal(rows[0]["Цена 1"],"18700");
 assert.equal(rows[0]["Цена 2"],"28000");
 assert.match(rows[0]["Описание"],/Объем: 50 мл/);
 assert.equal(rows[1]["Цена 2"],"20250");
 assert.equal(rows[2]["Наименование"],"AcnoCell Treatment Emulsion (150 мл)");
});
test("extracts a second row and single-price products without inventing retail values",()=>{
 const rows=extractPdfCardPage([
  a("Reform Age Micro Touch",30,600),
  a("Антивозрастная маска",30,624),
  a("Цена: 16 800",30,730),
 ],3,595,843);
 assert.equal(rows.length,1);
 assert.equal(rows[0]["Цена 1"],"16800");
 assert.equal(rows[0]["Цена 2"],"");
 assert.equal(rows[0]["Наименование"],"Reform Age Micro Touch");
});
test("parses lower-page card prices at 94% page height",()=>{
 const rows=extractPdfCardPage([
  a("Bottom Row Serum",23,585),
  a("Уход за кожей",23,625),
  a("Объем: 120 мл",23,660),
  a("Цена: 25 700 / 37 500",23,791)
 ],10,595,843);
 assert.equal(rows.length,1);
 assert.equal(rows[0]["Цена 1"],"25700");
 assert.equal(rows[0]["Цена 2"],"37500");
 assert.equal(rows[0]["Наименование"],"Bottom Row Serum (120 мл)");
});
test("ignores headers and unrelated text when no price anchor is found",()=>{
 const rows=extractPdfCardPage([
  a("JeuDerm",200,110),
  a("Г. АЛМАТЫ",310,795),
  a("+77011234567",310,810),
  a("Marketing brochure",20,300)
 ],1,595,843);
 assert.deepEqual(rows,[]);
});
test("invalid content is rejected before loading PDF parser",async()=>{
 await assert.rejects(parsePdfSupplier(new Uint8Array([1,2,3])),/pdf_file_size_limit_8mb/);
 const text=new TextEncoder().encode("Not a pdf, this is an arbitrary encoded binary payload");
 await assert.rejects(parsePdfSupplier(text),/invalid_pdf_signature/);
});
