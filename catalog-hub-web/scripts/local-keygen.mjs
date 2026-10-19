#!/usr/bin/env node
/**
 * Client-side key provisioner. Does not connect to Supabase.
 * Copy the SQL into the correct Supabase project's SQL editor explicitly.
 */
import {createHash,randomBytes,randomUUID} from "node:crypto";
const id="local-"+randomUUID();
const key="ch_local_"+randomBytes(36).toString("base64url");
const hash=createHash("sha256").update(key).digest("hex");
console.log("API-ключ (показывается только сейчас, не отправляйте его в чат или GitHub):");
console.log(key);
console.log("");
console.log("На панели Supabase проекта Catalog Hub выполните SQL:");
console.log(`INSERT INTO public."CatalogApiKey" ("id","name","keyHash","isActive")
VALUES ('${id}','Catalog Hub — Ubuntu local','${hash}',true);
-- Для отзыва доступа: UPDATE public."CatalogApiKey" SET "isActive"=false WHERE "id"='${id}';`);
console.log("");
console.log("После выполнения SQL запишите ключ в CATALOG_HUB_API_KEY файла .env.local.");
console.log("Ключ даёт доступ к API. Локальный интерфейс по умолчанию заблокирует запись, но сам ключ НЕ ограничен только чтением.");
console.log("Ничего не добавлено в Supabase автоматически.");
