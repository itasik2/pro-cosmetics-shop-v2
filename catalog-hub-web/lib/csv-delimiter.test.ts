import test from "node:test";
import assert from "node:assert/strict";
import {detectCsvDelimiter} from "./csv-delimiter";

test("CSV header ignores semicolons inside a quoted comma-separated column",()=>{
 const input='"Код; артикул; поставщик; идентификатор",Название,Цена\n"AB;1",Крем,1500';
 assert.equal(detectCsvDelimiter(input),",");
});

test("CSV header ignores commas inside a quoted semicolon-separated column",()=>{
 const input='"Название, полное, с составом";Артикул;Цена\n"Крем, уход",A-1;1500';
 assert.equal(detectCsvDelimiter(input),";");
});

test("multiline quoted CSV header is treated as one logical row",()=>{
 const input='"Описание;\nсостав;\nкомментарий",Артикул,Цена\n"Крем; уход",A-2,1600';
 assert.equal(detectCsvDelimiter(input),",");
});

test("escaped quotes and UTF-8 BOM do not distort separator detection",()=>{
 const input='\uFEFF"Код; ""поставщика""; SKU",Название,Цена\r\nA-3,Сыворотка,1700';
 assert.equal(detectCsvDelimiter(input),",");
});

test("a conventional semicolon CSV retains its existing delimiter",()=>{
 assert.equal(detectCsvDelimiter("Артикул;Наименование;Цена\r\nA-4;Маска;2000"),";");
});
