#!/usr/bin/env node
// Only localhost Docker DB is ever written. No live Supabase project is linked.
import {spawnSync} from "node:child_process";
import {createHash,randomBytes} from "node:crypto";
import {existsSync,readFileSync,writeFileSync,chmodSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const base=dirname(fileURLToPath(import.meta.url));
const root=resolve(base,".."),web=join(root,"catalog-hub-web"),hub=join(root,"marketplace-hub");
const compose=["compose","-f",join(base,"compose.yaml")];
const credentialsFile=join(base,".test-credentials.json");
const envFile=join(web,".env.test.local");
const localDb="postgresql://catalog_test:catalog_test_only@127.0.0.1:55432/catalog_test";

function run(cmd,args,stdin=null,env=process.env){
 const process=spawnSync(cmd,args,{cwd:root,env,input:stdin===null?undefined:stdin,encoding:"utf8",
   stdio:stdin===null?"inherit":["pipe","inherit","inherit"],timeout:180000});
 if(process.error)throw new Error(cmd+": "+process.error.message);
 if(process.status!==0)throw new Error(cmd+" завершился с кодом "+process.status);
}
function config(path){
 const out={};
 if(!existsSync(path))return out;
 for(const line of readFileSync(path,"utf8").split(/\r?\n/)){
  if(!line||line.trimStart().startsWith("#"))continue;
  const p=line.indexOf("=");
  if(p<1)continue;
  out[line.slice(0,p).trim()]=line.slice(p+1).trim().replace(/^["']|["']$/g,"");
 }
 return out;
}
function privateFile(path,data){
 writeFileSync(path,data,{mode:0o600});chmodSync(path,0o600);
}
function sqlQuote(x){return "'"+x.replaceAll("'","''")+"'";}
function getCredentials(){
 if(existsSync(credentialsFile)){
  const existing=JSON.parse(readFileSync(credentialsFile,"utf8"));
  if(typeof existing.key!=="string"||!/^ch_test_[A-Za-z0-9_-]{32,}$/.test(existing.key))
    throw new Error("Повреждён локальный файл тестового ключа.");
  return existing;
 }
 const cred={key:"ch_test_"+randomBytes(36).toString("base64url")};
 privateFile(credentialsFile,JSON.stringify(cred,null,2)+"\n");
 return cred;
}
function seedSql(key){
 const hash=createHash("sha256").update(key).digest("hex");
 return [
 "BEGIN;",
 `CREATE TABLE IF NOT EXISTS public."CatalogApiKey" (
   "id" text PRIMARY KEY, "name" text NOT NULL, "keyHash" text NOT NULL,
   "isActive" boolean NOT NULL DEFAULT true, "createdAt" timestamp NOT NULL DEFAULT now(),
   "lastUsedAt" timestamp);`,
 `INSERT INTO public."CatalogApiKey"("id","name","keyHash","isActive")
 VALUES ('catalog-ubuntu-test','Ubuntu isolated Docker API',`+sqlQuote(hash)+`,true)
 ON CONFLICT ("id") DO UPDATE SET "keyHash"=EXCLUDED."keyHash","isActive"=true;`,
 `INSERT INTO public."Organization" ("id","name","createdAt","updatedAt")
 VALUES ('org_procosmetics','DEMO Catalog Hub Test (no live customers)',now(),now())
 ON CONFLICT ("id") DO NOTHING;`,
 `INSERT INTO public."Warehouse" ("id","organizationId","code","name","isActive","createdAt","updatedAt")
 VALUES ('wh_pav_01','org_procosmetics','TEST-01','Тестовый склад (не реальный)',true,now(),now())
 ON CONFLICT ("id") DO NOTHING;`,
 `INSERT INTO public."CatalogCategory" ("id","organizationId","key","name","isActive","createdAt","updatedAt")
 VALUES ('demo-cat-skin','org_procosmetics','Увлажнение','Увлажнение',true,now(),now()),
 ('demo-cat-clean','org_procosmetics','Очищение и тонизация','Очищение и тонизация',true,now(),now()),
 ('demo-cat-age','org_procosmetics','Антивозрастной уход','Антивозрастной уход',true,now(),now()),
 ('demo-cat-sun','org_procosmetics','Защита от солнца','Защита от солнца',true,now(),now())
 ON CONFLICT ("organizationId","key") DO NOTHING;`,
 `INSERT INTO public."Product"("id","organizationId","sku","barcode","title","brand",
 "categoryKey","attributes","images","purchasePrice","basePrice","createdAt","updatedAt")
 VALUES ('demo-item-001','org_procosmetics','TEST-LOCAL-001','9780000000001',
 'Тестовая увлажняющая сыворотка','Demo','Увлажнение','{}'::jsonb,'[]'::jsonb,3000,4500,now(),now()),
 ('demo-item-002','org_procosmetics','TEST-LOCAL-002','9780000000002',
 'Тестовый очищающий крем','Demo','Очищение и тонизация','{}'::jsonb,'[]'::jsonb,4000,6500,now(),now()),
 ('demo-item-003','org_procosmetics','TEST-LOCAL-003','9780000000003',
 'Тестовая сыворотка против морщин','Demo','Антивозрастной уход','{}'::jsonb,'[]'::jsonb,4500,7400,now(),now()),
 ('demo-item-004','org_procosmetics','TEST-LOCAL-UNCATEGORIZED','9780000000004',
 'Тестовый товар без категории','Demo','Без категории','{}'::jsonb,'[]'::jsonb,1000,1500,now(),now())
 ON CONFLICT ("organizationId","sku") DO NOTHING;`,
 `INSERT INTO public."Inventory"("id","productId","warehouseId","onHand","reserved","safetyStock","updatedAt")
 VALUES ('demo-inv-001','demo-item-001','wh_pav_01',12,0,1,now()),
 ('demo-inv-002','demo-item-002','wh_pav_01',4,0,0,now()),
 ('demo-inv-003','demo-item-003','wh_pav_01',9,0,2,now())
 ON CONFLICT ("productId","warehouseId") DO NOTHING;`,
 "COMMIT;"
 ].join("\n");
}
function main(){
 console.log("Подготовка изолированной базы на Ubuntu. Рабочая Supabase не используется.");
 run("docker",["compose","version"]);
 run("docker",[...compose,"up","-d","db"]);
 // Explicit localhost target overrides *any* inherited DATABASE_URL.
 run("npm",["--prefix",hub,"install"],null,{...process.env,DATABASE_URL:localDb});
 run("npm",["--prefix",hub,"run","prisma:push"],null,{...process.env,DATABASE_URL:localDb});
 const credentials=getCredentials();
 run("docker",[...compose,"exec","-T","db","psql","-v","ON_ERROR_STOP=1",
  "-U","catalog_test","-d","catalog_test"],seedSql(credentials.key));
 run("docker",[...compose,"up","-d","api"]);
 const existing=config(join(web,".env.local")),previous=config(envFile);
 const password=previous.CATALOG_HUB_UI_PASSWORD||existing.CATALOG_HUB_UI_PASSWORD||
   randomBytes(15).toString("base64url");
 const token=previous.CATALOG_HUB_UI_SESSION_TOKEN||existing.CATALOG_HUB_UI_SESSION_TOKEN||
   randomBytes(32).toString("hex");
 privateFile(envFile,[
  "# ONLY for isolated Docker test backend. Do not commit.",
  "CATALOG_HUB_API_URL=http://127.0.0.1:8000",
  "CATALOG_HUB_API_KEY="+credentials.key,
  "CATALOG_HUB_ORGANIZATION_ID=org_procosmetics",
  "CATALOG_HUB_WAREHOUSE_ID=wh_pav_01",
  "NEXT_PUBLIC_CATALOG_HUB_NAME=Catalog Hub — TEST",
  "CATALOG_HUB_UI_PASSWORD="+password,
  "CATALOG_HUB_UI_SESSION_TOKEN="+token,
  "CATALOG_HUB_LOCAL_MODE=true",
  "CATALOG_HUB_LOCAL_WRITE_ENABLED=true",
  ""
 ].join("\n"));
 console.log("Создана тестовая база с 3 вымышленными товарами.");
 console.log("Сформирован .env.test.local. Текущая .env.local НЕ изменена.");
 console.log("Затем: npm run testdb:use; npm run local:check; npm run local:dev.");
}
try{main()}catch(e){console.error("Ошибка тестовой среды:",e.message);process.exitCode=1;}
