#!/usr/bin/env node
/**
 * Non-mutating connectivity check. Never logs the Catalog Hub key.
 */
import { readFileSync,existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath=resolve(process.cwd(),".env.local");
if(!existsSync(envPath)){
  console.error("Нет .env.local. Выполните npm run local:init.");
  process.exit(1);
}
const config={};
for(const raw of readFileSync(envPath,"utf8").split(/\r?\n/)){
  const line=raw.trim();
  if(!line||line.startsWith("#"))continue;
  const at=line.indexOf("=");
  if(at<1)continue;
  const key=line.slice(0,at).trim();
  const value=line.slice(at+1).trim().replace(/^["']|["']$/g,"");
  config[key]=value;
}
const required=["CATALOG_HUB_API_URL","CATALOG_HUB_API_KEY","CATALOG_HUB_UI_PASSWORD",
  "CATALOG_HUB_UI_SESSION_TOKEN","CATALOG_HUB_ORGANIZATION_ID"];
let missing=required.filter(key=>!config[key]);
if(missing.length){
  console.error("Нужно заполнить переменные:",missing.join(", "));
  process.exit(1);
}
let url;
try{
  url=new URL(config.CATALOG_HUB_API_URL.replace(/\/$/,""));
}catch{
  console.error("CATALOG_HUB_API_URL не является действительным URL.");
  process.exit(1);
}
if(url.protocol!=="https:"&&!["localhost","127.0.0.1"].includes(url.hostname)){
  console.error("API должен использовать HTTPS (кроме локального API).");
  process.exit(1);
}
const base=url.toString().replace(/\/$/,"");
if(config.CATALOG_HUB_LOCAL_MODE!=="true") console.warn("ВНИМАНИЕ: CATALOG_HUB_LOCAL_MODE не включён. Проверьте .env.local.");
console.log("Режим: "+(config.CATALOG_HUB_LOCAL_WRITE_ENABLED==="true"?"ЗАПИСЬ ВКЛЮЧЕНА — проверяйте тестовую БД":"только чтение (безопасно)"));
console.log("Проверка адреса API:",url.hostname);
async function probe(path,headers={}){
  const result=await fetch(base+path,{method:"GET",headers,signal:AbortSignal.timeout(15000),cache:"no-store"});
  return result;
}
try{
  const health=await probe("/health");
  if(!health.ok)throw new Error("health: HTTP "+health.status);
  console.log("Сервер API отвечает: HTTP "+health.status);
  const org=encodeURIComponent(config.CATALOG_HUB_ORGANIZATION_ID);
  const products=await probe("/v1/catalog/product-options?organizationId="+org,{
    "x-catalog-hub-key":config.CATALOG_HUB_API_KEY,
  });
  if(!products.ok){
    const status=products.status;
    throw new Error(status===401?"API-ключ неверный или неактивный (401).":"Проверка авторизации: HTTP "+status);
  }
  const rows=await products.json();
  if(!Array.isArray(rows))throw new Error("Неожиданный ответ каталога.");
  console.log("Авторизация работает. Товаров в списке: "+rows.length);
  console.log("Локальный запуск: npm run local:dev");
  console.log("Откройте http://127.0.0.1:3001 и войдите с паролем из .env.local.");
}catch(err){
  console.error("Не удалось подключиться к Catalog Hub:",err.message);
  console.error("Проверьте интернет, адрес API и локальный API-ключ. Никакие данные не изменены.");
  process.exitCode=1;
}
