import {randomUUID} from "node:crypto";
import {mkdir,readFile,rename,writeFile,chmod,unlink} from "node:fs/promises";
import {join,resolve} from "node:path";
import {gzipSync,gunzipSync} from "node:zlib";
import type {Mapping,Field} from "./import-types";
import type {Table} from "./import-parser";
import {FIELD_LABELS} from "./import-types";

export type SupplierProfile={
  id:string;
  organizationId:string;
  name:string;
  notes:string;
  mapping:Mapping;
  createdAt:string;
  updatedAt:string;
};
export type LocalImportHistory={
  id:string;
  organizationId:string;
  profileId:string|null;
  fileName:string;
  format:string;
  action:"PREVIEW"|"APPLY";
  result:"PREVIEWED"|"COMPLETED"|"PARTIAL";
  totalRows:number;
  countByStatus:Record<string,number>;
  selectedRows:number;
  createdAt:string;
  hasSnapshot?:boolean;
};
export type LocalImportSnapshot={
  table:Omit<Table,"rows">;
  originalRows:Array<Record<string,string>>;
  fileSha256:string;
  mapping:Mapping;
  skuOverrides:Record<string,string>;
};
const MAX_PROFILES=40,MAX_HISTORY=300,MAX_FILE_BYTES=600000;
const MAX_SNAPSHOT_BYTES=8_000_000,MAX_SNAPSHOT_COMPRESSED=4_000_000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
let operations:Promise<void>=Promise.resolve();
function serialized<T>(operation:()=>Promise<T>):Promise<T>{
  const work=operations.then(operation,operation);
  operations=work.then(()=>undefined,()=>undefined);
  return work;
}
function storageDir(base?:string){return resolve(base||join(process.cwd(),".local-data"));}
function filename(base:string,name:string){return join(storageDir(base),name);}
function snapshotPath(base:string,id:string){
  if(!UUID.test(id))throw new Error("invalid_history_id");
  return join(storageDir(base),"import-snapshots",id+".json.gz");
}
async function removeSnapshot(base:string,id:string){
  await unlink(snapshotPath(base,id)).catch(e=>{
    if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;
  });
}
async function writeSnapshot(base:string,id:string,snapshot:LocalImportSnapshot){
  const payload=JSON.stringify(snapshot);
  if(Buffer.byteLength(payload,"utf8")>MAX_SNAPSHOT_BYTES)throw new Error("local_import_snapshot_too_large");
  const compressed=gzipSync(payload);
  if(compressed.byteLength>MAX_SNAPSHOT_COMPRESSED)throw new Error("local_import_snapshot_too_large");
  const dir=join(storageDir(base),"import-snapshots");
  await mkdir(dir,{recursive:true,mode:0o700});
  const draft=join(dir,"."+id+"."+randomUUID()+".tmp");
  await writeFile(draft,compressed,{mode:0o600,flag:"wx"});
  try{await rename(draft,snapshotPath(base,id));}
  catch(e){await unlink(draft).catch(()=>undefined);throw e;}
  await chmod(snapshotPath(base,id),0o600);
}
async function readList<T>(base:string,name:string):Promise<T[]>{
  let value:string;
  try{value=await readFile(filename(base,name),"utf8");}
  catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return [];throw e;}
  if(Buffer.byteLength(value,"utf8")>MAX_FILE_BYTES)throw new Error("local_profile_store_too_large");
  const parsed:unknown=JSON.parse(value);
  if(!Array.isArray(parsed))throw new Error("invalid_local_profile_store");
  return parsed as T[];
}
async function writeList<T>(base:string,name:string,data:T[]):Promise<void>{
  const dir=storageDir(base);
  await mkdir(dir,{recursive:true,mode:0o700});
  const output=JSON.stringify(data,null,2)+"\n";
  if(Buffer.byteLength(output,"utf8")>MAX_FILE_BYTES)throw new Error("local_profile_store_too_large");
  const draft=join(dir,"."+name+"."+randomUUID()+".tmp");
  await writeFile(draft,output,{mode:0o600,flag:"wx"});
  await rename(draft,join(dir,name));
  await chmod(join(dir,name),0o600);
}
function requiredName(v:unknown,key:string,max:number){
  if(typeof v!=="string"||v.trim().length<2||v.trim().length>max)throw new Error("invalid_"+key);
  return v.trim();
}
export function validateProfileMapping(input:unknown):Mapping{
  if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("invalid_mapping");
  const result:Mapping={};
  const used=new Set<string>();
  for(const [key,value] of Object.entries(input)){
    if(!(key in FIELD_LABELS)||typeof value!=="string"||value.length>120)
      throw new Error("invalid_mapping_field");
    if(!value)continue;
    if(used.has(value))throw new Error("duplicate_mapping_column");
    used.add(value);
    result[key as Field]=value;
  }
  if(!Object.keys(result).length)throw new Error("empty_mapping");
  return result;
}
export async function listSupplierProfiles(organizationId:string,base?:string):Promise<SupplierProfile[]>{
  const rows=await readList<SupplierProfile>(storageDir(base),"supplier-profiles.json");
  return rows.filter(p=>p.organizationId===organizationId).sort((a,b)=>a.name.localeCompare(b.name,"ru"));
}
export async function saveSupplierProfile(input:{
  id?:string;organizationId:string;name:unknown;notes?:unknown;mapping:unknown;
},base?:string):Promise<SupplierProfile>{
  const name=requiredName(input.name,"profile_name",120);
  const notes=input.notes===undefined?"":String(input.notes);
  if(notes.length>400)throw new Error("invalid_profile_notes");
  const mapping=validateProfileMapping(input.mapping);
  if(input.id&&!/^[a-f0-9-]{36}$/i.test(input.id))throw new Error("invalid_profile_id");
  const dir=storageDir(base);
  return serialized(async()=>{
    const rows=await readList<SupplierProfile>(dir,"supplier-profiles.json");
    const index=input.id?rows.findIndex(p=>p.id===input.id&&p.organizationId===input.organizationId):-1;
    if(input.id&&index===-1)throw new Error("profile_not_found");
    if(rows.some((p,i)=>i!==index&&p.organizationId===input.organizationId&&p.name.toLowerCase()===name.toLowerCase()))
      throw new Error("profile_name_exists");
    if(index===-1&&rows.filter(p=>p.organizationId===input.organizationId).length>=MAX_PROFILES)
      throw new Error("too_many_supplier_profiles");
    const now=new Date().toISOString();
    const item:SupplierProfile={
      id:index>=0?rows[index].id:randomUUID(),
      organizationId:input.organizationId,
      name,notes,mapping,
      createdAt:index>=0?rows[index].createdAt:now,
      updatedAt:now,
    };
    if(index>=0)rows[index]=item;else rows.push(item);
    await writeList(dir,"supplier-profiles.json",rows);
    return item;
  });
}
export async function deleteSupplierProfile(organizationId:string,id:string,base?:string):Promise<boolean>{
  if(!/^[a-f0-9-]{36}$/i.test(id))throw new Error("invalid_profile_id");
  const dir=storageDir(base);
  return serialized(async()=>{
    const rows=await readList<SupplierProfile>(dir,"supplier-profiles.json");
    const rest=rows.filter(p=>p.id!==id||p.organizationId!==organizationId);
    if(rest.length===rows.length)return false;
    await writeList(dir,"supplier-profiles.json",rest);
    return true;
  });
}
export async function listLocalImportHistory(organizationId:string,base?:string):Promise<LocalImportHistory[]>{
  const rows=await readList<LocalImportHistory>(storageDir(base),"supplier-import-history.json");
  return rows.filter(h=>h.organizationId===organizationId)
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export async function loadLocalImportSnapshot(organizationId:string,id:string,base?:string):Promise<{
  entry:LocalImportHistory;snapshot:LocalImportSnapshot;
}>{
  if(!UUID.test(id))throw new Error("invalid_history_id");
  const rows=await readList<LocalImportHistory>(storageDir(base),"supplier-import-history.json");
  const entry=rows.find(row=>row.id===id&&row.organizationId===organizationId);
  if(!entry)throw new Error("history_entry_not_found");
  if(!entry.hasSnapshot)throw new Error("history_snapshot_unavailable");
  let data:Buffer;
  try{data=await readFile(snapshotPath(storageDir(base),id));}
  catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")throw new Error("history_snapshot_unavailable");throw e;}
  if(data.byteLength>MAX_SNAPSHOT_COMPRESSED)throw new Error("local_import_snapshot_too_large");
  const raw=gunzipSync(data,{maxOutputLength:MAX_SNAPSHOT_BYTES}).toString("utf8");
  const snapshot=JSON.parse(raw) as LocalImportSnapshot;
  if(!snapshot||!snapshot.table||!Array.isArray(snapshot.table.headers)||snapshot.table.headers.length>50||
     !Array.isArray(snapshot.originalRows)||snapshot.originalRows.length>400||
     !/^[a-f0-9]{64}$/.test(snapshot.fileSha256)||
     !snapshot.mapping||typeof snapshot.mapping!=="object"||
     !snapshot.skuOverrides||typeof snapshot.skuOverrides!=="object")
    throw new Error("invalid_history_snapshot");
  return {entry,snapshot};
}
export async function deleteLocalImportHistory(organizationId:string,ids:string[],base?:string){
  if(!Array.isArray(ids)||ids.length<1||ids.length>MAX_HISTORY||
     ids.some(id=>typeof id!=="string"||!UUID.test(id))||new Set(ids).size!==ids.length)
    throw new Error("invalid_history_ids");
  const dir=storageDir(base),selected=new Set(ids);
  return serialized(async()=>{
    const rows=await readList<LocalImportHistory>(dir,"supplier-import-history.json");
    const removed=rows.filter(row=>row.organizationId===organizationId&&selected.has(row.id));
    if(!removed.length)return 0;
    for(const row of removed)if(row.hasSnapshot)await removeSnapshot(dir,row.id);
    await writeList(dir,"supplier-import-history.json",rows.filter(row=>!removed.includes(row)));
    return removed.length;
  });
}
export async function recordLocalImportEvent(input:Omit<LocalImportHistory,"id"|"createdAt"|"hasSnapshot">&{
  snapshot?:LocalImportSnapshot;
},base?:string){
  const dir=storageDir(base);
  return serialized(async()=>{
    const rows=await readList<LocalImportHistory>(dir,"supplier-import-history.json");
    const {snapshot,...details}=input;
    const entry:LocalImportHistory={
      ...details,
      fileName:input.fileName.replace(/[\\/\x00-\x1f]/g,"_").slice(0,160),
      createdAt:new Date().toISOString(),id:randomUUID(),
      hasSnapshot:Boolean(snapshot),
    };
    if(snapshot)await writeSnapshot(dir,entry.id,snapshot);
    rows.push(entry);
    try{
      for(const old of rows.slice(0,-MAX_HISTORY))if(old.hasSnapshot)await removeSnapshot(dir,old.id);
      await writeList(dir,"supplier-import-history.json",rows.slice(-MAX_HISTORY));
    }
    catch(e){if(snapshot)await removeSnapshot(dir,entry.id);throw e;}
    return entry;
  });
}
