import test from "node:test";
import assert from "node:assert/strict";
import {isSameOrigin} from "./same-origin";

function req(origin:string|undefined,host:string,proto="http"){
 const headers:Record<string,string>={host};
 if(origin!==undefined)headers.origin=origin;
 return new Request(proto+"://internal-app.invalid/api/import",{headers});
}
test("Ubuntu browser localhost and 127.0.0.1 requests pass same-origin",()=>{
 assert.equal(isSameOrigin(req("http://127.0.0.1:3001","127.0.0.1:3001")),true);
 assert.equal(isSameOrigin(req("http://localhost:3001","localhost:3001")),true);
});
test("cross-site requests, protocol downgrade, forged host and absent origin fail",()=>{
 const cases: Array<[string|undefined,string,string]> = [
  ["http://evil.invalid:3001","127.0.0.1:3001","http"],
  ["http://localhost:3002","localhost:3001","http"],
  ["http://localhost:3001","127.0.0.1:3001","http"],
  ["https://localhost:3001","localhost:3001","http"],
  ["http://localhost:3001","localhost:3001","https"],
  [undefined,"localhost:3001","http"],
  ["http://localhost:3001/path","localhost:3001","http"],
 ];
 for(const [origin,host,proto] of cases)
  assert.equal(isSameOrigin(req(origin,host,proto)),false,origin||"missing origin");
});
test("reverse proxy external HTTPS is respected",()=>{
 const headers=new Headers({
  origin:"https://catalog.example.com",host:"catalog.example.com",
  "x-forwarded-proto":"https"
 });
 assert.equal(isSameOrigin(new Request("http://localhost:3000/api/import",{headers})),true);
});
