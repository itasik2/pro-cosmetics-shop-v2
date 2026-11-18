"use client";
import {useEffect,useRef,useState} from "react";
import {coreMessage,coreRequest} from "@/lib/core-client";
type Webhook={id:string;url:string;secretRef:string;topics:string[];state:string;version:number;generation:number};
type Delivery={id:string;eventId:string;status:string;version:number;attempts:number;lastError:string|null;createdAt:string;deliveredAt:string|null;receipt?:{status:string}|null};
type Info={webhook:Webhook|null;topics:string[];stats:Array<{status:string;count:number}>;deliveries:Delivery[];nextCursor:string|null};
const states:Record<string,string>={PENDING:"Ожидает",PROCESSING:"Отправляется",RETRY:"Ожидает повтора",DEAD:"Требует проверки",DELIVERED:"Получено",CANCELED:"Отменено при смене адреса"};
const labels:Record<string,string>={"catalog.product_changed":"Карточки товаров","inventory.changed":"Остатки","channel.offer_changed":"Предложения канала","channel.mappings_changed":"Сопоставления","catalog.variants_grouped":"Объединение вариантов","catalog.variants_ungrouped":"Разделение вариантов"};
export function WebhookConsole({connectionId,environment,canWrite}:{connectionId:string;environment:string;canWrite:boolean}){
 const [info,setInfo]=useState<Info|null>(null),[url,setUrl]=useState(""),[secretRef,setSecret]=useState(""),[topics,setTopics]=useState<string[]>([]),[state,setState]=useState("PAUSED");
 const [reason,setReason]=useState(""),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const operation=useRef<{signature:string;key:string}|null>(null);
 const [filter,setFilter]=useState("");
 const path="channels/"+encodeURIComponent(connectionId)+"/webhook";
 function applyInfo(value:Info){setInfo(value);setFilter("");setUrl(value.webhook?.url||"");setSecret(value.webhook?.secretRef||"");setTopics(value.webhook?.topics||value.topics);setState(value.webhook?.state||"PAUSED");}
 async function page(status:string,cursor=""){
  setBusy(true);setError("");try{const value=await coreRequest<Info>(path+"?status="+encodeURIComponent(status)+"&cursor="+encodeURIComponent(cursor));
   setInfo(previous=>previous?{...previous,stats:value.stats,deliveries:value.deliveries,nextCursor:value.nextCursor}:value);setFilter(status);
  }catch(cause){setError(coreMessage(cause));}finally{setBusy(false);}
 }
 useEffect(()=>{
  const controller=new AbortController();setBusy(true);
  coreRequest<Info>(path,undefined,undefined,controller.signal).then(value=>{if(!controller.signal.aborted)applyInfo(value);})
   .catch(cause=>{if(!controller.signal.aborted)setError(coreMessage(cause));}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[path]);
 async function refresh(){setBusy(true);setError("");try{applyInfo(await coreRequest<Info>(path));setConfirmed(false);operation.current=null;}catch(cause){setError(coreMessage(cause));}finally{setBusy(false);}}
 async function mutate(target:string,body:unknown){const signature=JSON.stringify({target,body});if(operation.current?.signature!==signature)operation.current={signature,key:crypto.randomUUID()};return coreRequest(target,body,operation.current.key);}
 async function save(){
  if(busy||!canWrite||!confirmed)return;setBusy(true);setError("");setMessage("");
  try{await mutate(path,{url,secretRef,topics,state,expectedVersion:info?.webhook?.version||0,confirmed:true,reason});
   applyInfo(await coreRequest<Info>(path));setConfirmed(false);operation.current=null;setMessage("Настройки получателя сохранены.");
  }catch(cause){setError(coreMessage(cause));}finally{setBusy(false);}
 }
 async function retry(delivery:Delivery){
  if(busy||!canWrite||reason.trim().length<5||!window.confirm("Повторить доставку этого уведомления текущему получателю?"))return;
  setBusy(true);setError("");setMessage("");
  try{await mutate("sync/deliveries/"+encodeURIComponent(delivery.id)+"/retry",{confirmed:true,expectedVersion:delivery.version,reason});
   applyInfo(await coreRequest<Info>(path));operation.current=null;setMessage("Уведомление возвращено в очередь.");
  }catch(cause){setError(coreMessage(cause));}finally{setBusy(false);}
 }
 return <section className="core-preview" aria-busy={busy}>
  <h3>Доставка событий</h3>
  <p className="subtle">Получатель принимает подписанные уведомления и читает актуальные данные своего подключения. Статус «Получено» подтверждает запись во входящую очередь; публикация предложений проверяется отдельно.</p>
  {environment!=="TEST"&&<p className="subtle">Включение доставки в рабочий магазин доступно после пилота.</p>}
  <fieldset className="core-form" disabled={busy||!canWrite||!info}>
   <label>Адрес получателя<input className="input" type="url" maxLength={2048} value={url} placeholder="https://store.example/api/catalog-events" onChange={event=>{setUrl(event.target.value);setConfirmed(false);}} /></label>
   <label>Имя серверного секрета<input className="input" maxLength={104} value={secretRef} placeholder="CATALOG_DELIVERY_SECRET_MY_STORE" onChange={event=>{setSecret(event.target.value);setConfirmed(false);}} /></label>
   <label>Режим доставки<select className="input" value={state} onChange={event=>{setState(event.target.value);setConfirmed(false);}}>
    <option value="PAUSED">Приостановлена</option>{environment==="TEST"&&<option value="ACTIVE">Включена для тестового подключения</option>}</select></label>
   <label>Основание изменения<input className="input" minLength={5} maxLength={500} value={reason} onChange={event=>{setReason(event.target.value);setConfirmed(false);}} /></label>
   <fieldset><legend>Какие изменения передавать</legend>{info?.topics.map(topic=><label className="core-confirm" style={{display:"flex",alignItems:"center",gap:8}} key={topic}><input style={{width:16,height:16,flexShrink:0}} type="checkbox" checked={topics.includes(topic)} onChange={event=>{setTopics(previous=>event.target.checked?[...previous,topic]:previous.filter(value=>value!==topic));setConfirmed(false);}} /> {labels[topic]||topic}</label>)}</fieldset>
   <label className="core-confirm" style={{display:"flex",alignItems:"center",gap:8}}><input style={{width:16,height:16,flexShrink:0}} type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} /> Подтверждаю получателя и режим доставки</label>
  </fieldset>
  <p className="subtle">Вводится имя настройки, сам секрет хранится на серверах. Смена адреса или набора событий отменит незавершённые доставки и создаст новое уведомление об обновлении. Для отправки нужен настроенный фоновый обработчик.</p>
  <div className="actions"><button type="button" className="button primary" disabled={busy||!canWrite||!info||!confirmed||!url||!secretRef||!topics.length||reason.trim().length<5} onClick={()=>void save()}>Сохранить получателя</button>
   <button type="button" className="button" disabled={busy} onClick={()=>void refresh()}>Обновить доставки</button></div>
  {error&&<p className="error" role="alert">{error}</p>}{message&&<p className="core-success" role="status">{message}</p>}
  {!!info?.stats.length&&<p>{info.stats.map(stat=>(states[stat.status]||stat.status)+": "+stat.count).join(" · ")}</p>}
  {info?.webhook&&<div className="actions"><button type="button" className="button" disabled={busy} onClick={()=>void page("")}>Все уведомления</button>
   <button type="button" className="button" disabled={busy} onClick={()=>void page("DEAD")}>Требуют проверки</button>
   {info.nextCursor&&<button type="button" className="button" disabled={busy} onClick={()=>void page(filter,info.nextCursor!)}>Следующие доставки</button>}</div>}
  {!!info?.deliveries.length&&<div className="table-wrap"><table><thead><tr><th>Время</th><th>Статус</th><th>Попытки</th><th>Действия</th></tr></thead><tbody>{info.deliveries.map(delivery=><tr key={delivery.id}>
   <td>{new Date(delivery.createdAt).toLocaleString("ru-RU")}</td><td>{states[delivery.status]||delivery.status}{delivery.lastError&&<div className="subtle">{coreMessage(new Error(delivery.lastError))}</div>}</td><td>{delivery.attempts} / 8</td><td>{delivery.status==="DEAD"&&<button type="button" className="button" disabled={busy||!canWrite||reason.trim().length<5} onClick={()=>void retry(delivery)}>Повторить доставку</button>}</td>
  </tr>)}</tbody></table></div>}
 </section>;
}
