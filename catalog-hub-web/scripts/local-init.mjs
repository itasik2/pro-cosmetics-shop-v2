#!/usr/bin/env node
/**
 * Run once locally; never prints or commits Catalog Hub API secrets.
 * Defaults to the production backend but leaves all UI writes disabled.
 */
import { existsSync,writeFileSync,chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const target=resolve(process.cwd(),".env.local");
if(existsSync(target)){
  console.log(".env.local уже существует. Файл не изменён.");
  console.log("Проверьте настройки: npm run local:check");
  process.exit(0);
}
const password=randomBytes(15).toString("base64url");
const token=randomBytes(32).toString("hex");
const config=[
 "# Только для запуска Catalog Hub на вашем компьютере (не публиковать в Git).",
 "CATALOG_HUB_API_URL=https://numgkiqnzavgachcvtwv.supabase.co/functions/v1/catalog-hub",
 "# Вставьте действующий ключ Catalog Hub локально. Не пишите его в чат или GitHub.",
 "CATALOG_HUB_API_KEY=",
 "CATALOG_HUB_ORGANIZATION_ID=org_procosmetics",
 "CATALOG_HUB_WAREHOUSE_ID=wh_pav_01",
 "NEXT_PUBLIC_CATALOG_HUB_NAME=Catalog Hub (локально)",
 "CATALOG_HUB_LOCAL_MODE=true",
 "CATALOG_HUB_UI_PASSWORD="+password,
 "CATALOG_HUB_UI_SESSION_TOKEN="+token,
 "",
 "# По умолчанию режим ТОЛЬКО ЧТЕНИЕ. Включайте запись только для тестовой БД.",
 "CATALOG_HUB_LOCAL_WRITE_ENABLED=false",
 "",
].join("\n");
try{
  writeFileSync(target,config,{flag:"wx",mode:0o600});
  chmodSync(target,0o600);
}catch(error){
  console.error("Не удалось создать .env.local:",error.message);
  process.exitCode=1;process.exit();
}
console.log("Создан .env.local с правами доступа 600.");
console.log("Локальный пароль для первого входа: "+password);
console.log("Сохраните пароль. Повторный запуск не перезаписывает настройки.");
console.log("Осталось вставить API-ключ в CATALOG_HUB_API_KEY внутри .env.local.");
console.log("Затем: npm run local:check && npm run local:dev");
console.log("Адрес после запуска: http://127.0.0.1:3001");
