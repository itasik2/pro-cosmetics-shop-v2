"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {coreMessage,coreRequest} from "@/lib/core-client";

type Run={id:string;fileName:string;state:string;expectedRows:number;uploadedRows:number;processedRows:number;failedRows:number;version:number};
type Row={rowNumber:number;sku:string;action:string;state:string;attempts:number;errorCode:string|null;result?:{id?:string}|null};
const states:Record<string,string>={UPLOADING:"Подготовка",QUEUED:"В очереди",RUNNING:"Обработка",SUCCEEDED:"Завершён",PARTIAL:"Завершён с ошибками",CANCELED:"Остановлен",PENDING:"Ожидает",APPLIED:"Применено",STAGED:"На согласовании",ERROR:"Ошибка"};
const actions:Record<string,string>={CREATE:"Создание",STAGE:"Согласование",AUTO_INCREASE:"Повышение цены"};
export function ImportQueue({focusId,canWrite}:{focusId:string;canWrite:boolean}){
  const [runs,setRuns]=useState<Run[]>([]),[error,setError]=useState("");
  const [reportId,setReportId]=useState(""),[rows,setRows]=useState<Row[]>([]),[cursor,setCursor]=useState<number|null>(null);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function tick(){
      let active=false;
      try{
        const current=await coreRequest<Run[]>("imports",undefined,undefined,controller.signal);
        if(controller.signal.aborted)return;
        setRuns(current);setError("");
        const next=current.find(r=>r.state==="QUEUED"||r.state==="RUNNING");
        active=Boolean(next);
        if(next&&canWrite){
          const result=await coreRequest<Run>("imports/"+next.id+"/process",{limit:50},crypto.randomUUID(),controller.signal);
          if(!controller.signal.aborted)setRuns(previous=>previous.map(r=>r.id===result.id?result:r));
        }
      }catch(e){if(!controller.signal.aborted)setError(coreMessage(e));}
      if(!controller.signal.aborted)timer=setTimeout(()=>void tick(),active?1500:5000);
    }
    void tick();return()=>{controller.abort();clearTimeout(timer);};
  },[focusId,canWrite]);
  async function report(id:string,after=0){
    setBusy(true);setError("");
    try{
      const data=await coreRequest<{items:Row[];nextCursor:number|null}>("imports/"+id+"/rows?limit=100&after="+after);
      setReportId(id);setRows(data.items);setCursor(data.nextCursor);
    }catch(e){setError(coreMessage(e));}finally{setBusy(false);}
  }
  async function change(run:Run,action:"cancel"|"retry"){
    if(!window.confirm(action==="cancel"?"Остановить оставшиеся строки? Выполненные изменения сохранятся.":"Повторить ошибочные строки? Версии карточек и ценовые правила будут проверены заново."))return;
    setBusy(true);setError("");
    try{
      const updated=await coreRequest<Run>("imports/"+run.id+"/"+action,{confirmed:true,expectedVersion:run.version});
      setRuns(previous=>previous.map(r=>r.id===updated.id?updated:r));
    }catch(e){setError(coreMessage(e));}finally{setBusy(false);}
  }
  if(!runs.length&&!error)return null;
  return <section className="panel" style={{marginTop:16}}><h2>Очередь импортов</h2>
    <p className="subtle">Подтверждённые строки обрабатываются порциями. Прогресс хранится на сервере; повторные запросы продолжают задачу. Незавершённые задачи продолжатся при открытии страницы или через настроенный фоновый обработчик.</p>
    {runs.map(run=><div className="panel" key={run.id} style={{marginBottom:10,borderColor:run.id===focusId?"var(--accent)":undefined}}>
      <strong>{run.fileName}</strong> · {states[run.state]||run.state}
      <p>{run.state==="UPLOADING"?`Подготовлено ${run.uploadedRows} из ${run.expectedRows}`:`Обработано ${run.processedRows} из ${run.expectedRows}. Ошибок: ${run.failedRows}`}</p>
      <progress value={run.state==="UPLOADING"?run.uploadedRows:run.processedRows} max={run.expectedRows} aria-label={"Прогресс "+run.fileName} style={{width:"100%"}}/>
      {run.state==="UPLOADING"&&<p className="subtle">Подготовка ещё не завершена. Повторите постановку с тем же файлом и выбранными строками: уже загруженные части сохранятся. Применение начнётся после полной проверки.</p>}
      <div className="actions"><button type="button" className="button" disabled={busy} onClick={()=>void report(run.id)}>Отчёт по строкам</button>
        {["UPLOADING","QUEUED","RUNNING"].includes(run.state)&&<button type="button" className="button" disabled={!canWrite||busy} onClick={()=>void change(run,"cancel")}>Остановить</button>}
        {run.state==="PARTIAL"&&<button type="button" className="button" disabled={!canWrite||busy} onClick={()=>void change(run,"retry")}>Повторить ошибки</button>}</div>
    </div>)}
    {reportId&&<div><h3>Отчёт по строкам</h3><div className="table-wrap"><table><thead><tr><th>Строка / SKU</th><th>Операция</th><th>Результат</th></tr></thead>
      <tbody>{rows.map(row=><tr key={row.rowNumber}><td>{row.rowNumber} · {row.sku}</td><td>{actions[row.action]||row.action}</td><td>{states[row.state]||row.state}
        {row.errorCode&&<div className="error">{coreMessage(new Error(row.errorCode))}</div>}
        {row.result?.id&&<div><Link href={(row.action==="STAGE"?"/changes/":"/catalog/")+encodeURIComponent(row.result.id)}>Открыть →</Link></div>}</td></tr>)}</tbody></table></div>
      <div className="actions"><button type="button" className="button" disabled={busy} onClick={()=>void report(reportId)}>С начала</button>
        {cursor!==null&&<button type="button" className="button" disabled={busy} onClick={()=>void report(reportId,cursor)}>Следующие строки →</button>}</div>
    </div>}
    {error&&<p className="error" role="alert">{error}</p>}
  </section>;
}
