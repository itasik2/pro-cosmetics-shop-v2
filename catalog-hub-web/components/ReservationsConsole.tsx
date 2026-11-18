"use client";
import { useEffect, useRef, useState } from "react";
import { coreMessage, coreRequest } from "@/lib/core-client";

type Item = {productId:string;warehouseId:string;sku:string;warehouseName:string;quantity:number;released:number;shipped:number;returned:number;remaining:number;returnable:number};
type Reservation = {id:string;reference:string;reason:string;status:string;version:number;createdAt:string;items:Item[]};
type Page = {items:Reservation[];nextCursor:string|null};
type Action = "release"|"ship"|"return";
const actions = {release:"Освободить",ship:"Отгрузить",return:"Принять возврат"};
const statuses:Record<string,string> = {ACTIVE:"Активен",RELEASED:"Освобождён",FULFILLED:"Отгружен",PARTIALLY_RETURNED:"Частичный возврат",RETURNED:"Возвращён"};
const pair = (item:Item) => item.productId+":"+item.warehouseId;

export function ReservationsConsole({refreshToken,canWrite,onChanged}:{refreshToken:number;canWrite:boolean;onChanged:()=>void}) {
  const [page,setPage] = useState<Page|null>(null);
  const [busy,setBusy] = useState(false),[error,setError] = useState(""),[message,setMessage] = useState("");
  const [selected,setSelected] = useState<{reservation:Reservation;action:Action}|null>(null);
  const [quantities,setQuantities] = useState<Record<string,string>>({});
  const [reason,setReason] = useState(""),[confirmed,setConfirmed] = useState(false);
  const operation = useRef<{signature:string;key:string}|null>(null);
  useEffect(()=>{
    const abort = new AbortController();
    setBusy(true);setError("");setSelected(null);
    coreRequest<Page>("reservations?limit=20",undefined,undefined,abort.signal).then(setPage)
      .catch(cause=>{if(!abort.signal.aborted)setError(coreMessage(cause));})
      .finally(()=>{if(!abort.signal.aborted)setBusy(false);});
    return ()=>abort.abort();
  },[refreshToken]);
  async function inspect(cursor?:string) {
    if(busy)return;
    setBusy(true);setError("");setSelected(null);
    try {setPage(await coreRequest<Page>("reservations?limit=20"+(cursor?"&cursor="+encodeURIComponent(cursor):"")));}
    catch(cause){setError(coreMessage(cause));}finally{setBusy(false);}
  }
  function choose(reservation:Reservation,action:Action) {
    setSelected({reservation,action});setReason("");setConfirmed(false);setError("");setMessage("");operation.current=null;
    setQuantities(Object.fromEntries(reservation.items.map(item=>[pair(item),String(action==="return"?item.returnable:item.remaining)])));
  }
  const items = selected?.reservation.items.map(item=>({productId:item.productId,warehouseId:item.warehouseId,quantity:Number(quantities[pair(item)] || 0)})).filter(item=>item.quantity>0) || [];
  const valid = selected && items.length>0 && reason.trim().length>=5 && selected.reservation.items.every(item=>{
    const count=Number(quantities[pair(item)] || 0),max=selected.action==="return"?item.returnable:item.remaining;
    return Number.isSafeInteger(count)&&count>=0&&count<=max;
  });
  async function apply() {
    if(!selected||!valid||!confirmed||busy||!canWrite)return;
    const body={expectedVersion:selected.reservation.version,confirmed:true,reason,items};
    const path="reservations/"+encodeURIComponent(selected.reservation.id)+"/"+selected.action;
    const signature=JSON.stringify({path,body});
    if(operation.current?.signature!==signature)operation.current={signature,key:crypto.randomUUID()};
    setBusy(true);setError("");setMessage("");
    try {
      await coreRequest<Reservation>(path,body,operation.current.key);
      setMessage("Операция с резервом сохранена.");setSelected(null);operation.current=null;onChanged();
    }catch(cause){setError(coreMessage(cause));}finally{setBusy(false);}
  }
  return <section className="panel core-section" aria-busy={busy}>
    <h2>Отдельные резервы</h2><p className="subtle">Создайте резерв через складскую операцию. Укажите количество для освобождения, отгрузки или возврата. Ноль оставляет позицию без изменения.</p>
    <div className="actions"><button type="button" className="button" disabled={busy} onClick={()=>void inspect()}>Обновить резервы</button>
      {page?.nextCursor&&<button type="button" className="button" disabled={busy} onClick={()=>void inspect(page.nextCursor!)}>Следующие резервы</button>}</div>
    {error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status" className="core-success">{message}</p>}
    {page&&!page.items.length&&<p className="subtle">Отдельных резервов пока нет.</p>}
    {!!page?.items.length&&<div className="table-wrap"><table><thead><tr><th>Документ / дата</th><th>Товар / склад</th><th>Количество</th><th>Статус</th><th>Действия</th></tr></thead>
      <tbody>{page.items.map(reservation=><tr key={reservation.id}>
        <td>{reservation.reference}<div className="subtle">{new Date(reservation.createdAt).toLocaleString("ru-RU")}</div><div className="subtle">{reservation.reason}</div></td>
        <td>{reservation.items.map(item=><div key={pair(item)}>{item.sku} / {item.warehouseName}</div>)}</td>
        <td>{reservation.items.map(item=><div key={pair(item)}>Резерв: {item.remaining}; отгружено: {item.shipped}; возвращено: {item.returned}; освобождено: {item.released}</div>)}</td>
        <td>{statuses[reservation.status]||reservation.status}</td><td><div className="actions">
          {reservation.items.some(item=>item.remaining>0)&&(["release","ship"] as const).map(action=><button className="button" key={action} disabled={busy||!canWrite} onClick={()=>choose(reservation,action)}>{actions[action]}</button>)}
          {reservation.items.some(item=>item.returnable>0)&&<button className="button" disabled={busy||!canWrite} onClick={()=>choose(reservation,"return")}>{actions.return}</button>}
        </div></td></tr>)}</tbody></table></div>}
    {selected&&<div className="core-preview"><h3>{actions[selected.action]}: {selected.reservation.reference}</h3>
      <fieldset className="core-form" disabled={busy||!canWrite}>
        {selected.reservation.items.map(item=>{const max=selected.action==="return"?item.returnable:item.remaining;return <label key={pair(item)}>
          {item.sku} / {item.warehouseName} (доступно {max})<input className="input" type="number" min={0} max={max} step={1}
            value={quantities[pair(item)]||"0"} onChange={event=>{setQuantities(old=>({...old,[pair(item)]:event.target.value}));setConfirmed(false);}} /></label>;})}
        <label>Основание операции<input className="input" value={reason} minLength={5} maxLength={500} onChange={event=>{setReason(event.target.value);setConfirmed(false);}} /></label>
        <label className="core-confirm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} /> Подтверждаю действие и количество</label>
      </fieldset><div className="actions"><button className="button primary" disabled={!valid||!confirmed||busy||!canWrite} onClick={()=>void apply()}>Сохранить операцию с резервом</button>
        <button className="button" disabled={busy} onClick={()=>setSelected(null)}>Закрыть</button></div></div>}
  </section>;
}
