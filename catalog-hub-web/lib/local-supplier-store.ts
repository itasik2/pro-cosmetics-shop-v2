import {randomUUID} from "node:crypto";
import {mkdir,readFile,rename,writeFile,chmod} from "node:fs/promises";
import {join,resolve} from "node:path";
import type {Mapping,Field} from "./import-types";
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
};
const MAX_PROFILES=40,MAX_HISTORY=300,MAX_FILE_BYTES=600000;
let operations:Promise<void>=Promise.resolve();
function serialized<T>(operation:()=>Promise<T>):Promise<T>{
  const work=operations.then(operation,operation);
  operations=work.then(()=>undefined,()=>undefined);
  return work;
}
function storageDir(base?:string){return resolve(base||join(process.cwd(),".local-data"));}
function filename(base:string,name:string){return join(storageDir(base),name);}
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
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,75);
}
export async function recordLocalImportEvent(input:Omit<LocalImportHistory,"id"|"createdAt">,base?:string){
  const dir=storageDir(base);
  return serialized(async()=>{
    const rows=await readList<LocalImportHistory>(dir,"supplier-import-history.json");
    const entry:LocalImportHistory={
      ...input,
      fileName:input.fileName.replace(/[\\/\x00-\x1f]/g,"_").slice(0,160),
      createdAt:new Date().toISOString(),id:randomUUID(),
    };
    rows.push(entry);
    await writeList(dir,"supplier-import-history.json",rows.slice(-MAX_HISTORY));
    return entry;
  });
}
