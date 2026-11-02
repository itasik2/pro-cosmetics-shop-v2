import test from "node:test";
import assert from "node:assert/strict";
import { extractMesalteraTablePage, isMesalteraTable } from "./pdf-mesaltera";
import type { PdfTextFragment } from "./pdf-supplier";
import { suggestRelationships } from "./import-relationships";

const f = (text: string, x: number, y: number): PdfTextFragment => ({text,x,y});
const width = 595, height = 843;

test("Mesaltera table detection requires supplier and recognizable two-price columns",()=>{
 const header = [
  f("mesaltera.kazakhstan",60,140),f("Наименование",45,226),
  f("Объём",414,225),f("Ваша цена, тг.",477,226),
  f("Клиент. цена, тг.",530,226),
 ];
 assert.equal(isMesalteraTable(header),true);
 assert.equal(isMesalteraTable(header.slice(1)),false);
 assert.equal(isMesalteraTable([f("mesaltera",50,50),f("Цена: 19 000",80,90)]),false);
});

test("realistic multi-row layout retains different pack prices as separate supplier variants",()=>{
 const fragments = [
  f("Cleanser Demo",25,273),f("Очищающая вода",25,285),
  f("для лица",25,296),
  f("200",413,271),f("мл.",429,271),
  f("5",482,270),f("000",489,270),f("8",536,271),f("900",544,271),
  f("400",413,308),f("мл.",429,308),
  f("8",482,308),f("800",489,308),f("15",534,308),f("800",544,308),
  f("Sensi Cleanser",25,360),f("Мицеллярная вода",25,382),
  f("195",413,381),f("мл.",429,381),
  f("6",482,380),f("500",489,380),f("11",534,381),f("500",544,381),
 ];
 const rows=extractMesalteraTablePage(fragments,1,width,height);
 assert.equal(rows.length,3);
 assert.deepEqual(rows.map(row=>[row["Наименование"],row["Объем"],row["Цена 1"],row["Цена 2"]]),[
  ["Cleanser Demo (200 мл)","200 мл","5000","8900"],
  ["Cleanser Demo (400 мл)","400 мл","8800","15800"],
  ["Sensi Cleanser (195 мл)","195 мл","6500","11500"],
 ]);
 assert.ok(rows.every(row=>row["Артикул"]===""&&row["Бренд"]==="MESALTERA"));
 const suggestions=suggestRelationships(rows.map((row,i)=>({
  rowNumber:i+2,sku:"P"+i,barcode:"",brand:row["Бренд"],
  title:row["Наименование"],volume:row["Объем"],errors:[],
 })));
 assert.equal(suggestions[0]?.kind,"VARIANT");
 assert.deepEqual(suggestions[0]?.indices,[1]);
 assert.equal(suggestions[2],null);
});

test("title that starts below the first price is associated with that first pack",()=>{
 const rows=extractMesalteraTablePage([
  f("200 мл.",413,555),f("7800",482,555),f("13900",534,555),
  f("Ethereal Cleanser Milk",25,576),
  f("Очищающее молочко",25,588),
  f("400 мл.",413,612),f("10900",482,612),f("19500",534,612),
 ],1,width,height);
 assert.deepEqual(rows.map(row=>row["Наименование"]),[
  "Ethereal Cleanser Milk (200 мл)",
  "Ethereal Cleanser Milk (400 мл)",
 ]);
});

test("range packs, zero size, missing price and unnamed rows are skipped safely",()=>{
 const rows=extractMesalteraTablePage([
  f("200 мл.",413,190),f("5000",482,190),f("8900",534,190), // no confirmed title
  f("Unrelated Product",25,300),
  f("0 мл.",413,300),f("5000",482,300),f("8900",534,300),
  f("0,8 - 1,5 мл.",407,340),f("600",482,340),f("1100",534,340),
  f("300 мл.",413,380),f("9900",482,380), // second price missing
 ],1,width,height);
 assert.deepEqual(rows,[]);
});

test("single Russian product names and separate units are preserved",()=>{
 const rows=extractMesalteraTablePage([
  f("Набор пробников",25,480),
  f("2 шт.",413,480),f("2500",482,480),f("3900",534,480),
 ],7,width,height);
 assert.equal(rows.length,1);
 assert.equal(rows[0]["Наименование"],"Набор пробников (2 шт)");
 assert.equal(rows[0]["Цена 2"],"3900");
});

test("dense accessories list never combines distinct products into a single title",()=>{
 const rows=extractMesalteraTablePage([
  f("Блокнот",25,400),f("1 шт.",413,400),f("1000",482,400),f("1800",534,400),
  f("Ручка",25,412),f("1 шт.",413,412),f("500",482,412),f("900",534,412),
  f("Значок",25,426),f("1 шт.",413,426),f("1500",482,426),f("2800",534,426),
  f("Косметичка",25,438),f("1 шт.",413,440),f("2300",482,440),f("3000",534,440),
  f("Кисть косметологическая",25,452),f("1 шт.",413,452),f("1500",482,452),f("2200",534,452),
  f("Миска силиконовая",25,464),f("1 шт.",413,466),f("2000",482,466),f("3000",534,466),
 ],9,width,height);
 assert.equal(rows.length,6);
 assert.deepEqual(rows.map(row=>row["Наименование"]),[
  "Блокнот (1 шт)","Ручка (1 шт)","Значок (1 шт)",
  "Косметичка (1 шт)","Кисть косметологическая (1 шт)",
  "Миска силиконовая (1 шт)",
 ]);
});

test("specialized importer ignores textual forbidden retail price",()=>{
 assert.deepEqual(extractMesalteraTablePage([
  f("Peeling Example",25,202),f("30 мл.",413,221),
  f("17000",482,221),f("Запрет",534,221),
 ],9,width,height),[]);
});
