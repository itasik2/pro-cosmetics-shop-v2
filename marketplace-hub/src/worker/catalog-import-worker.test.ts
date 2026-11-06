import test from "node:test";
import assert from "node:assert/strict";
import {importWorkerBackoff,importWorkerCycle,type WorkerFailure} from "./catalog-import-worker.js";

const queued=(id:string,createdAt="2026-11-06T00:00:00Z")=>({id,createdAt,state:"QUEUED",expectedRows:10,processedRows:0,failedRows:0});
const options={baseUrl:"http://127.0.0.1:8000",key:"synthetic-worker-secret"};
const response=(data:unknown,status=200,headers?:HeadersInit)=>new Response(JSON.stringify(data),{status,headers});

test("worker validates transport, credentials and bounds before making a request",async()=>{
  const fetchImpl:typeof fetch=async()=>{throw new Error("must not fetch");};
  for(const patch of [{baseUrl:"http://outside.test"},{baseUrl:"https://name:password@example.test"},{baseUrl:"https://example.test?token=x"},
    {baseUrl:"invalid"},{key:""},{batchLimit:0},{batchLimit:101},{batchLimit:1.5},{requestTimeoutMs:0}]){
    await assert.rejects(importWorkerCycle({...options,...patch,fetchImpl}),/worker_/);
  }
});
test("each approved job gets one bounded batch, oldest first; uploads are ignored",async()=>{
  const calls:Array<{path:string;body:unknown}>=[];
  const fetchImpl:typeof fetch=async(input,init)=>{
    const path=new URL(String(input)).pathname;
    calls.push({path,body:init?.body?JSON.parse(String(init.body)):null});
    assert.equal(new Headers(init?.headers).get("x-catalog-hub-key"),options.key);
    assert.equal(init?.redirect,"error");
    if(!init?.body)return response([queued("new","2026-11-06T01:00:00Z"),{...queued("upload"),state:"UPLOADING"},queued("old")]);
    return response({...queued(path.includes("old")?"old":"new"),state:"RUNNING",processedRows:3});
  };
  const runs=await importWorkerCycle({...options,batchLimit:3,fetchImpl});
  assert.deepEqual(runs.map(r=>r.id),["old","new"]);
  assert.deepEqual(calls.map(c=>c.path),["/v1/imports","/v1/imports/old/process","/v1/imports/new/process"]);
  assert.deepEqual(calls.slice(1).map(c=>c.body),[{limit:3},{limit:3}]);
});
test("one unavailable job does not starve its peers; failures contain no response body or credentials",async()=>{
  const failures:WorkerFailure[]=[];
  const fetchImpl:typeof fetch=async(input,init)=>!init?.body?response([queued("bad"),queued("good")]):
    String(input).includes("/bad/")?response({secret:options.key},503,{"retry-after":"12"}):response({...queued("good"),state:"SUCCEEDED",processedRows:10});
  const runs=await importWorkerCycle({...options,fetchImpl,onError:failure=>failures.push(failure)});
  assert.deepEqual(runs.map(r=>r.id),["good"]);
  assert.deepEqual(failures,[{runId:"bad",code:"worker_api_503",retryable:true,retryAfterMs:12000}]);
  await assert.rejects(importWorkerCycle({...options,fetchImpl}),/worker_api_503/);
});
test("revoked credentials stop the cycle immediately",async()=>{
  let calls=0;
  const fetchImpl:typeof fetch=async(_input,init)=>{calls++;return !init?.body?response([queued("first"),queued("second")]):response({},403);};
  await assert.rejects(importWorkerCycle({...options,fetchImpl,onError:()=>assert.fail("credential errors are global")}),/worker_api_403/);
  assert.equal(calls,2);
});
test("pre-aborted worker starts no work; abort during an unknown outcome starts no next batch",async()=>{
  const controller=new AbortController();controller.abort();
  assert.deepEqual(await importWorkerCycle({...options,signal:controller.signal,fetchImpl:async()=>assert.fail("aborted request")}),[]);
  const running=new AbortController();let posts=0;
  const fetchImpl:typeof fetch=async(_input,init)=>{
    if(!init?.body)return response([queued("first"),queued("second")]);
    posts++;running.abort();throw new Error("response lost after commit: "+options.key);
  };
  assert.deepEqual(await importWorkerCycle({...options,signal:running.signal,fetchImpl,onError:()=>assert.fail("shutdown is not an error")}),[]);
  assert.equal(posts,1);
});
test("malformed responses and wrong run IDs fail safely",async()=>{
  for(const value of [{items:[]},[{}],[{...queued("bad"),expectedRows:0}]]){
    await assert.rejects(importWorkerCycle({...options,fetchImpl:async()=>response(value)}),/worker_invalid_response/);
  }
  await assert.rejects(importWorkerCycle({...options,fetchImpl:async(_input,init)=>response(init?.body?queued("different"):[queued("expected")])}),/worker_invalid_response/);
});
test("network errors are sanitized and Retry-After and exponential backoff are bounded",async()=>{
  await assert.rejects(importWorkerCycle({...options,fetchImpl:async()=>{throw new Error("leaked "+options.key);}}),/^Error: worker_unavailable$/);
  const failures:WorkerFailure[]=[];
  await importWorkerCycle({...options,fetchImpl:async(_input,init)=>init?.body?response({},429,{"retry-after":"999999"}):response([queued("busy")]),onError:f=>failures.push(f)});
  assert.equal(failures[0].retryAfterMs,60000);assert.equal(failures[0].retryable,true);
  assert.equal(importWorkerBackoff(1,0),3000);assert.equal(importWorkerBackoff(2,0),6000);
  assert.equal(importWorkerBackoff(100,1),60000);
});
