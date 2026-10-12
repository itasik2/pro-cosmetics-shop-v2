#!/usr/bin/env node
import {readFileSync,writeFileSync,existsSync,chmodSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";

const mode=process.argv[2];
if(mode!=="test"&&mode!=="remote"){console.error("Режим: test или remote");process.exit(1);}
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const web=join(root,"catalog-hub-web");
const currentFile=join(web,".env.local");
const testFile=join(web,".env.test.local");
const backupFile=join(web,".env.remote.backup");
function load(path){return existsSync(path)?readFileSync(path,"utf8"):null;}
function save(path,content){writeFileSync(path,content,{mode:0o600});chmodSync(path,0o600);}
function isTest(text){
 return /^CATALOG_HUB_API_URL=http:\/\/127\.0\.0\.1:8000\s*$/m.test(text||"")&&
   /^CATALOG_HUB_LOCAL_MODE=true\s*$/m.test(text||"");
}
try{
 if(mode==="test"){
  const test=load(testFile);
  if(!test||!isTest(test))throw new Error("Сначала npm run testdb:setup (тестовая конфигурация отсутствует).");
  const current=load(currentFile);
  if(current&&!isTest(current)){
    const backup=load(backupFile);
    if(backup&&backup!==current)
      throw new Error("Файл .env.remote.backup уже существует и отличается от текущего. Сохраните конфигурацию вручную.");
    if(!backup)save(backupFile,current);
  }
  save(currentFile,test);
  console.log("Активирован ТОЛЬКО локальный Docker API. Настройки удалённой Supabase сохранены в .env.remote.backup.");
 }else{
  const backup=load(backupFile);
  if(!backup)throw new Error("Нет .env.remote.backup: восстановить нечего.");
  const current=load(currentFile);
  if(current&&!isTest(current)&&current!==backup)
    throw new Error("Текущая конфигурация изменена вручную; отказ от перезаписи.");
  save(currentFile,backup);
  console.log("Возвращена конфигурация удалённой Supabase. Локальная запись снова защищена.");
 }
 console.log("Перезапустите npm run local:dev и проверьте npm run local:check.");
}catch(e){console.error(e.message);process.exitCode=1;}
