import assert from "node:assert/strict";
import test from "node:test";
import { planCatalogHubPull } from "../lib/catalogHubPullPlan";
import type { CatalogHubSnapshotItem } from "../lib/catalogHubClient";

const hub={shortDescription:"Кратко",description:"Подробно",application:"Нанести",ingredients:"Вода",
  images:["https://cdn.example/item.jpg"],categoryKey:"Уход",price:9000,purchasePrice:5000} as CatalogHubSnapshotItem;

test("keeps handwritten shop content and prices unless the operator opts into price changes",()=>{
  const local={shortDescription:"Своя аннотация",description:"Своё описание",image:"https://cdn.example/manual.jpg",
    category:"Ручная категория",price:8000,sourcePrice:4000};
  assert.deepEqual(planCatalogHubPull(hub,local),{});
  assert.deepEqual(planCatalogHubPull(hub,local,true),{price:9000,sourcePrice:5000});
});

test("fills gaps and composes application and ingredients without changing inventory",()=>{
  const local={shortDescription:null,description:"Описание готовится",image:"/seed/cleanser.jpg",
    category:"Без категории",price:8000,sourcePrice:4000};
  assert.deepEqual(planCatalogHubPull(hub,local),{shortDescription:"Кратко",
    description:"Подробно\n\nПрименение\nНанести\n\nСостав\nВода",
    image:"https://cdn.example/item.jpg",category:"Уход"});
});
