import test from "node:test";
import assert from "node:assert/strict";
import {isAllowedTestApiUrl,isLocalReadOnly,isMutation} from "./local-mode";

test("development is read-only by default",()=>{
 assert.equal(isLocalReadOnly({NODE_ENV:"development"}),true);
 assert.equal(isLocalReadOnly({NODE_ENV:"development",CATALOG_HUB_LOCAL_WRITE_ENABLED:"TRUE"}),true);
 assert.equal(isLocalReadOnly({NODE_ENV:"development",CATALOG_HUB_LOCAL_WRITE_ENABLED:"false"}),true);
});
test("a local write switch must also point at a loopback test API",()=>{
 assert.equal(isLocalReadOnly({NODE_ENV:"development",CATALOG_HUB_LOCAL_WRITE_ENABLED:"true"}),true);
 assert.equal(isLocalReadOnly({
  NODE_ENV:"development",CATALOG_HUB_LOCAL_WRITE_ENABLED:"true",
  CATALOG_HUB_API_URL:"https://numgkiqnzavgachcvtwv.supabase.co/functions/v1/catalog-hub"
 }),true);
 assert.equal(isLocalReadOnly({
  NODE_ENV:"development",CATALOG_HUB_LOCAL_WRITE_ENABLED:"true",
  CATALOG_HUB_API_URL:"http://127.0.0.1:8000"
 }),false);
 assert.equal(isLocalReadOnly({
  NODE_ENV:"production",CATALOG_HUB_LOCAL_MODE:"true",
  CATALOG_HUB_LOCAL_WRITE_ENABLED:"true",
  CATALOG_HUB_API_URL:"http://localhost:8000"
 }),false);
});
test("never trust other hosts or ports",()=>{
 for(const raw of [
  "https://127.0.0.1:8000","http://example.com:8000","http://192.168.1.22:8000",
  "http://127.0.0.1:8010","http://127.0.0.1.evil.tld:8000",
  "http://user:password@127.0.0.1:8000","ftp://127.0.0.1:8000"
 ])assert.equal(isAllowedTestApiUrl(raw),false,raw);
 assert.equal(isAllowedTestApiUrl("http://127.0.0.1:8000"),true);
 assert.equal(isAllowedTestApiUrl("http://localhost:54321/functions/v1/catalog-hub"),true);
});
test("production remains independent of the local-only guard",()=>{
 assert.equal(isLocalReadOnly({NODE_ENV:"production"}),false);
});
test("mutating HTTP verbs are recognized",()=>{
 for(const method of ["POST","PATCH","PUT","DELETE"])assert.equal(isMutation(method),true);
 for(const method of ["GET","HEAD","OPTIONS"])assert.equal(isMutation(method),false);
 assert.equal(isMutation(),false);
});
