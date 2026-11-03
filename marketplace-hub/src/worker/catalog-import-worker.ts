import {pathToFileURL} from "node:url";

type Run={id:string;state:string;processedRows:number;failedRows:number;expectedRows:number};
export async function importWorkerCycle(options:{baseUrl:string;key:string;signal?:AbortSignal;batchLimit?:number}){
  const url=new URL(options.baseUrl);
  if(url.protocol!=="https:" && !(url.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(url.hostname)))throw new Error("worker_https_required");
  if(url.username||url.password||url.search||url.hash)throw new Error("invalid_worker_url");
  if(!options.key)throw new Error("worker_key_required");
  const base=options.baseUrl.replace(/\/$/,"");
  async function request(path:string,body?:unknown){
    const response=await fetch(base+path,{method:body?"POST":"GET",redirect:"error",
      signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000),
      headers:{"x-catalog-hub-key":options.key,...(body?{"content-type":"application/json","idempotency-key":crypto.randomUUID()}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok)throw new Error("worker_api_"+response.status);
    return response.json();
  }
  const runs=await request("/v1/imports?active=true") as Run[],results:Run[]=[];
  for(const run of runs){
    if(options.signal?.aborted)break;
    results.push(await request("/v1/imports/"+encodeURIComponent(run.id)+"/process",{limit:options.batchLimit??100}) as Run);
  }
  return results;
}

async function main(){
  if(process.env.CATALOG_IMPORT_WORKER_ENABLED!=="true")throw new Error("worker_not_enabled");
  const controller=new AbortController();
  for(const signal of ["SIGTERM","SIGINT"] as const)process.once(signal,()=>controller.abort());
  const once=process.argv.includes("--once");
  do{
    try{
      const runs=await importWorkerCycle({baseUrl:process.env.CATALOG_HUB_API_URL||"",key:process.env.CATALOG_HUB_API_KEY||"",signal:controller.signal});
      for(const run of runs)console.log(JSON.stringify({event:"import.progress",runId:run.id,state:run.state,processedRows:run.processedRows,failedRows:run.failedRows}));
      if(once)break;
    }catch(error){
      if(controller.signal.aborted)break;
      console.error(JSON.stringify({event:"import.worker_error",code:error instanceof Error&&/^worker_[a-z0-9_]+$/.test(error.message)?error.message:"worker_unavailable"}));
      if(once){process.exitCode=1;break;}
    }
    await new Promise<void>(resolve=>{
      if(controller.signal.aborted)return resolve();
      const finish=()=>{clearTimeout(timer);controller.signal.removeEventListener("abort",finish);resolve();};
      const timer=setTimeout(finish,1500);controller.signal.addEventListener("abort",finish,{once:true});
    });
  }while(!controller.signal.aborted);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)void main().catch(()=>{console.error("import_worker_configuration_error");process.exitCode=1;});
