import test from "node:test";
import assert from "node:assert/strict";
import { suggestCategories } from "./suggest.js";
const categories=[
 "Уход за волосами","Проблемная кожа","Очищение и тонизация",
 "Осветление","Антивозрастной уход","Защита от солнца","Регенерация",
 "Ретиноиды","Чувствительная кожа",
];
test("suggests high-confidence hint for acne range, but does not write",()=>{
 const p={title:"AcnoCell Treatment Toner",shortDescription:"Для кожи с акне"};
 const before={...p};
 const result=suggestCategories(p,categories);
 assert.equal(result[0]?.key,"Проблемная кожа");
 assert.deepEqual(p,before);
});
test("title reveals brightening category, descriptions do not override it",()=>{
 const result=suggestCategories({
   title:"Mask Black for White",shortDescription:"Осветление и увлажнение"
 },categories);
 assert.equal(result[0]?.key,"Осветление");
});
test("description-only vague claim never produces automatic classification",()=>{
 assert.deepEqual(suggestCategories({
   title:"Product 123", description:"Крем с увлажняющим действием"
 },categories),[]);
});
test("matching short and full descriptions can classify a generic title",()=>{
 const result=suggestCategories({title:"Product 123",shortDescription:"Средство для очищения кожи",
   description:"Мягкое очищение лица перед уходом"},categories);
 assert.equal(result[0]?.key,"Очищение и тонизация");
 assert.equal(result[0]?.score,5);
});
test("inactive or nonexistent category cannot be suggested",()=>{
 const result=suggestCategories({title:"Hair Growth concentrate"},["Ретиноиды"]);
 assert.equal(result.length,0);
});
test("unknown product leaves manual review",()=>{
 assert.deepEqual(suggestCategories({title:"Неизвестный продукт"},categories),[]);
});
