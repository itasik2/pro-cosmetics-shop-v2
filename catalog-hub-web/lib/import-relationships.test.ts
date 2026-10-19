import test from "node:test";
import assert from "node:assert/strict";
import { suggestRelationships } from "./import-relationships";
import type { ImportItem } from "./import-parser";

const row = (title:string,sku:string,brand="Angiopharm"):ImportItem =>
  ({rowNumber:1,sku,title,brand,barcode:"",errors:[]});

test("suggests variants for distinct volumes and flags same volume as a possible duplicate",()=>{
  const result=suggestRelationships([
    row("Молочко очищающее (50 мл)","MV04"),
    row("Молочко очищающее (400 мл)","CL12"),
    row("Молочко очищающее (50 ml)","MV05"),
  ]);
  assert.equal(result[0]?.kind,"DUPLICATE");
  assert.deepEqual(result[0]?.indices,[2]);
  assert.equal(result[1]?.kind,"VARIANT");
  assert.deepEqual(result[1]?.indices,[0,2]);
});

test("does not infer variants across brands or without a verified volume",()=>{
  const result=suggestRelationships([
    row("Молочко очищающее (50 мл)","A"),
    row("Молочко очищающее (400 мл)","B","Other"),
    row("Молочко очищающее", "C"),
  ]);
  assert.deepEqual(result,[null,null,null]);
});
