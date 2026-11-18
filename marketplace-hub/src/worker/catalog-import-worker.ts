import {pathToFileURL} from "node:url";

type Run={id:string;state:string;processedRows:number;failedRows:number;expectedRows:number;createdAt?:string};
export type WorkerFailure={runId:string;code:string;retryable:boolean;retryAfterMs:number};
type Options={baseUrl:string;key:string;signal?:AbortSignal;batchLimit?:number;requestTimeoutMs?:number;fetchImpl?:typeof fetch;onError?:(failure:WorkerFailure)=>void};
class WorkerError extends Error {
  constructor(code:string,readonly retryable:boolean,readonly retryAfterMs=0){super(code);}
}
function validate(options:Options){
  let url:URL;
  try{url=new URL(options.baseUrl);}catch{throw new WorkerError("worker_url_required",false);}
  if(url.protocol!=="https:" && !(url.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(url.hostname)))throw new WorkerError("worker_https_required",false);
  if(url.username||url.password||url.search||url.hash)throw new WorkerError("worker_invalid_url",false);
  if(!options.key)throw new WorkerError("worker_key_required",false);
  if(!Number.isSafeInteger(options.batchLimit??100)||(options.batchLimit??100)<1||(options.batchLimit??100)>100)throw new WorkerError("worker_invalid_batch_limit",false);
  if(!Number.isSafeInteger(options.requestTimeoutMs??25000)||(options.requestTimeoutMs??25000)<1||(options.requestTimeoutMs??25000)>60000)throw new WorkerError("worker_invalid_timeout",false);
}
function failure(error:unknown):WorkerError {
  if(error instanceof WorkerError)return error;
  return new WorkerError(error instanceof Error&&["TimeoutError","AbortError"].includes(error.name)?"worker_timeout":"worker_unavailable",true);
}
function run(value:unknown):Run {
  const r=value as Run;
  if(!r||typeof r.id!=="string"||!r.id||r.id.length>128||!["UPLOADING","QUEUED","RUNNING","SUCCEEDED","PARTIAL","CANCELED"].includes(r.state)||
    ![r.processedRows,r.failedRows,r.expectedRows].every(v=>Number.isSafeInteger(v)&&v>=0)||r.expectedRows<1||r.expectedRows>10000||
    r.failedRows>r.processedRows||r.processedRows>r.expectedRows||r.createdAt!==undefined&&typeof r.createdAt!=="string")throw new WorkerError("worker_invalid_response",false);
  return r;
}
export function importWorkerBackoff(failures:number,random=Math.random()){
  return Math.min(60000,1500*2**Math.min(6,Math.max(1,failures))+Math.floor(Math.min(1,Math.max(0,random))*1000));
}
export async function importWorkerCycle(options:Options){
  validate(options);
  if(options.signal?.aborted)return [];
  const base=options.baseUrl.replace(/\/$/,""),fetcher=options.fetchImpl??fetch;
  async function request(path:string,body?:unknown):Promise<unknown>{
    const response=await fetcher(base+path,{method:body?"POST":"GET",redirect:"error",
      signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(options.requestTimeoutMs??25000)]):AbortSignal.timeout(options.requestTimeoutMs??25000),
      headers:{"x-catalog-hub-key":options.key,...(body?{"content-type":"application/json","idempotency-key":crypto.randomUUID()}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok){
      const seconds=Number(response.headers.get("retry-after"));
      throw new WorkerError("worker_api_"+response.status,[408,429].includes(response.status)||response.status>=500,
        Number.isFinite(seconds)&&seconds>0?Math.min(60000,seconds*1000):0);
    }
    try{return await response.json();}catch{throw new WorkerError("worker_invalid_response",false);}
  }
  let response:unknown;
  try{response=await request("/v1/imports?active=true");}catch(error){if(options.signal?.aborted)return [];throw failure(error);}
  if(!Array.isArray(response)||response.length>50)throw new WorkerError("worker_invalid_response",false);
  const runs=response.map(run).filter(r=>["QUEUED","RUNNING"].includes(r.state)).sort((a,b)=>(a.createdAt||"").localeCompare(b.createdAt||"")||a.id.localeCompare(b.id));
  const results:Run[]=[];let firstError:WorkerError|undefined;
  for(const current of runs){
    if(options.signal?.aborted)break;
    try{
      const updated=run(await request("/v1/imports/"+encodeURIComponent(current.id)+"/process",{limit:options.batchLimit??100}));
      if(updated.id!==current.id)throw new WorkerError("worker_invalid_response",false);
      results.push(updated);
    }catch(error){
      if(options.signal?.aborted)break;
      const issue=failure(error);
      // Invalid credentials affect every run. Stop instead of retrying each job.
      if(["worker_api_401","worker_api_403"].includes(issue.message))throw issue;
      firstError??=issue;
      options.onError?.({runId:current.id,code:issue.message,retryable:issue.retryable,retryAfterMs:issue.retryAfterMs});
    }
  }
  if(firstError&&!options.onError)throw firstError;
  return results;
}
function wait(ms:number,signal:AbortSignal){
  return new Promise<void>(resolve=>{
    if(signal.aborted)return resolve();
    const finish=()=>{clearTimeout(timer);signal.removeEventListener("abort",finish);resolve();};
    const timer=setTimeout(finish,ms);signal.addEventListener("abort",finish,{once:true});
  });
}
async function main(){
  if(process.env.CATALOG_IMPORT_WORKER_ENABLED!=="true")throw new WorkerError("worker_not_enabled",false);
  const controller=new AbortController();
  const stop=()=>controller.abort();
  for(const signal of ["SIGTERM","SIGINT"] as const)process.once(signal,stop);
  const options={baseUrl:process.env.CATALOG_HUB_API_URL||"",key:process.env.CATALOG_HUB_API_KEY||"",signal:controller.signal,
    batchLimit:Number(process.env.CATALOG_IMPORT_WORKER_BATCH_ROWS||100)};
  validate(options);
  const once=process.argv.includes("--once");let errors=0,lastHeartbeat=0;
  try{do{
    let failed=false,retryAfterMs=0;
    try{
      const runs=await importWorkerCycle({...options,onError:issue=>{
        failed=true;retryAfterMs=Math.max(retryAfterMs,issue.retryAfterMs);
        console.error(JSON.stringify({event:"import.run_error",...issue}));
      }});
      for(const current of runs)console.log(JSON.stringify({event:"import.progress",runId:current.id,state:current.state,processedRows:current.processedRows,failedRows:current.failedRows}));
      if(Date.now()-lastHeartbeat>=60000){console.log(JSON.stringify({event:"import.heartbeat",runs:runs.length}));lastHeartbeat=Date.now();}
      if(once){if(failed)process.exitCode=1;break;}
    }catch(error){
      if(controller.signal.aborted)break;
      const issue=failure(error);failed=true;retryAfterMs=issue.retryAfterMs;
      console.error(JSON.stringify({event:"import.worker_error",code:issue.message,retryable:issue.retryable}));
      if(once||!issue.retryable){process.exitCode=1;break;}
    }
    errors=failed?errors+1:0;
    await wait(failed?Math.max(retryAfterMs,importWorkerBackoff(errors)):1500,controller.signal);
  }while(!controller.signal.aborted);}finally{
    for(const signal of ["SIGTERM","SIGINT"] as const)process.removeListener(signal,stop);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)void main().catch(()=>{console.error("import_worker_configuration_error");process.exitCode=1;});
