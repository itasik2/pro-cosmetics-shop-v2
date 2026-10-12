import test from "node:test";
import assert from "node:assert/strict";
import {isLocalReadOnly,isMutation} from "./local-mode";

test("local UI is read-only without explicit opt-in",()=>{
  assert.equal(isLocalReadOnly({NODE_ENV:"development",CATALOG_HUB_LOCAL_WRITE_ENABLED:undefined}),true);
  assert.equal(isLocalReadOnly({NODE_ENV:"development",CATALOG_HUB_LOCAL_WRITE_ENABLED:"false"}),true);
  assert.equal(isLocalReadOnly({NODE_ENV:"development",CATALOG_HUB_LOCAL_WRITE_ENABLED:"TRUE"}),true);
});
test("write opt-in must be explicit and lowercase",()=>{
  assert.equal(isLocalReadOnly({NODE_ENV:"development",CATALOG_HUB_LOCAL_WRITE_ENABLED:"true"}),false);
});
test("production sessions are unaffected by local-only guard",()=>{
  assert.equal(isLocalReadOnly({NODE_ENV:"production",CATALOG_HUB_LOCAL_WRITE_ENABLED:undefined}),false);
});
test("all mutating HTTP methods are rejected in local safe mode",()=>{
  for(const method of ["POST","PUT","PATCH","DELETE"]) assert.equal(isMutation(method),true);
  for(const method of ["GET","HEAD","OPTIONS"]) assert.equal(isMutation(method),false);
  assert.equal(isMutation(undefined),false);
});
