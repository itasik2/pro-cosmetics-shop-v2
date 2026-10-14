import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,stat,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {
 deleteSupplierProfile,deleteLocalImportHistory,listLocalImportHistory,listSupplierProfiles,loadLocalImportSnapshot,
 recordLocalImportEvent,saveSupplierProfile,validateProfileMapping,
} from "./local-supplier-store";

async function temp(){return mkdtemp(join(tmpdir(),"catalog-supplier-"));}
const org="org_procosmetics";
const mapping={sku:"vendorCode",price:"Цена",barcode:"Штрихкод"};

test("local supplier profiles are saved with restrictive permissions and survive reload",async()=>{
  const dir=await temp();
  try{
    const saved=await saveSupplierProfile({organizationId:org,name:"Тестовый поставщик",notes:"CSV",mapping},dir);
    assert.equal(saved.name,"Тестовый поставщик");
    assert.deepEqual((await listSupplierProfiles(org,dir))[0]?.mapping,mapping);
    const info=await stat(join(dir,"supplier-profiles.json"));
    assert.equal(info.mode&0o777,0o600);
    assert.deepEqual(await listSupplierProfiles("org_another",dir),[]);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test("same supplier is updated rather than duplicated",async()=>{
 const dir=await temp();
 try{
   const first=await saveSupplierProfile({organizationId:org,name:"Поставщик 1",mapping},dir);
   const updated=await saveSupplierProfile({
     id:first.id,organizationId:org,name:"Поставщик 1",notes:"Новое описание",
     mapping:{sku:"Артикул",purchasePrice:"Закупка"}
   },dir);
   assert.equal(updated.id,first.id);
   assert.equal((await listSupplierProfiles(org,dir)).length,1);
   assert.equal(updated.notes,"Новое описание");
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("duplicate supplier names are rejected within an organization",async()=>{
 const dir=await temp();
 try{
   await saveSupplierProfile({organizationId:org,name:"Supplier A",mapping},dir);
   await assert.rejects(
     saveSupplierProfile({organizationId:org,name:"supplier a",mapping},dir),
     /profile_name_exists/,
   );
   assert.equal((await listSupplierProfiles(org,dir)).length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("invalid profile mapping cannot be persisted",()=>{
 assert.throws(()=>validateProfileMapping({price:"Цена",sku:"Цена"}),/duplicate_mapping_column/);
 assert.throws(()=>validateProfileMapping({password:"password"}),/invalid_mapping_field/);
 assert.throws(()=>validateProfileMapping({}),/empty_mapping/);
});
test("concurrent profile saves are serialized with no lost updates",async()=>{
 const dir=await temp();
 try{
   await Promise.all(Array.from({length:10},(_,i)=>
     saveSupplierProfile({organizationId:org,name:"Поставщик "+i,mapping},dir)));
   assert.equal((await listSupplierProfiles(org,dir)).length,10);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("local import audit contains summary but no source file content",async()=>{
 const dir=await temp();
 try{
   await recordLocalImportEvent({
     organizationId:org,profileId:null,fileName:"supplier/data.csv",
     format:"CSV",action:"PREVIEW",result:"PREVIEWED",totalRows:3,
     countByStatus:{CREATE:1,UPDATE:1,CONFLICT:1},selectedRows:0
   },dir);
   const rows=await listLocalImportHistory(org,dir);
   assert.equal(rows.length,1);
   assert.equal(rows[0].fileName,"supplier_data.csv");
   assert.equal(rows[0].countByStatus.CONFLICT,1);
   assert.equal((await stat(join(dir,"supplier-import-history.json"))).mode&0o777,0o600);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("removing a supplier mapping does not affect the history",async()=>{
 const dir=await temp();
 try{
   const p=await saveSupplierProfile({organizationId:org,name:"Supplier A",mapping},dir);
   await recordLocalImportEvent({
     organizationId:org,profileId:p.id,fileName:"supplier.csv",
     format:"CSV",action:"PREVIEW",result:"PREVIEWED",totalRows:1,
     countByStatus:{UPDATE:1},selectedRows:0
   },dir);
   assert.equal(await deleteSupplierProfile(org,p.id,dir),true);
   assert.deepEqual(await listSupplierProfiles(org,dir),[]);
   assert.equal((await listLocalImportHistory(org,dir)).length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("saved rows reopen within their organization and deleting selected history removes the private snapshot",async()=>{
 const dir=await temp();
 try{
   const snapshot={
     table:{format:"CSV",headers:["sku","title","price"],rows:[{sku:"TEST-001",title:"Крем 50 мл",price:"1200"}]},
     originalRows:[{sku:"TEST-001",title:"Крем 50 мл",price:"1200"}],
     fileSha256:"a".repeat(64),mapping:{sku:"sku",title:"title",price:"price"},skuOverrides:{},
   };
   const entry=await recordLocalImportEvent({
     organizationId:org,profileId:null,fileName:"supplier.csv",format:"CSV",action:"PREVIEW",
     result:"PREVIEWED",totalRows:1,countByStatus:{CREATE:1},selectedRows:0,snapshot,
   },dir);
   const filename=join(dir,"import-snapshots",entry.id+".json.gz");
   assert.equal((await stat(filename)).mode&0o777,0o600);
   assert.equal((await stat(join(dir,"import-snapshots"))).mode&0o777,0o700);
   assert.equal((await loadLocalImportSnapshot(org,entry.id,dir)).snapshot.table.rows[0].sku,"TEST-001");
   assert.equal((await readFile(join(dir,"supplier-import-history.json"),"utf8")).includes("TEST-001"),false);
   await assert.rejects(loadLocalImportSnapshot("other-org",entry.id,dir),/history_entry_not_found/);
   assert.equal(await deleteLocalImportHistory("other-org",[entry.id],dir),0);
   assert.equal(await deleteLocalImportHistory(org,[entry.id],dir),1);
   assert.deepEqual(await listLocalImportHistory(org,dir),[]);
   await assert.rejects(stat(filename),{code:"ENOENT"});
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("old history entries remain removable but cannot reopen without source rows",async()=>{
 const dir=await temp();
 try{
   const entry=await recordLocalImportEvent({organizationId:org,profileId:null,fileName:"old.pdf",
     format:"PDF",action:"PREVIEW",result:"PREVIEWED",totalRows:2,countByStatus:{CREATE:2},selectedRows:0},dir);
   await assert.rejects(loadLocalImportSnapshot(org,entry.id,dir),/history_snapshot_unavailable/);
   assert.equal(await deleteLocalImportHistory(org,[entry.id],dir),1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
