"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { HubProduct } from "@/lib/hub";

type Warehouse = { id:string;code:string;name:string;isActive:boolean };
type Adjustment = {
  id:string;delta:number;beforeOnHand:number;afterOnHand:number;reason:string;
  createdAt:string;warehouseCode:string;warehouseName:string;
};
const receiptReasons=["Приход поставщика","Возврат покупателя","Инвентаризация: излишек",
  "Перемещение со склада","Корректировка остатка"];
const writeoffReasons=["Списание брака","Истёк срок годности","Возврат поставщику",
  "Инвентаризация: недостача","Перемещение на другой склад","Корректировка остатка"];
export function StockAdjustment({product,warehouses}:{
  product:HubProduct;warehouses:Warehouse[]
}) {
  const router=useRouter();
  const [warehouseId,setWarehouseId]=useState(warehouses[0]?.id||"");
  const [delta,setDelta]=useState("");
  const [reasonChoice,setReasonChoice]=useState("");
  const [otherReason,setOtherReason]=useState("");
  const [confirm,setConfirm]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const [history,setHistory]=useState<Adjustment[]>([]);
  const requestId=useRef<string|null>(null);
  const selected=product.inventory?.find(v=>v.warehouseId===warehouseId);
  const before=selected?.onHand||0;
  const reserved=selected?.reserved||0;
  const change=Number(delta);
  const reason=reasonChoice==="other"?otherReason:reasonChoice;
  const reasonOptions=change>0?receiptReasons:change<0?writeoffReasons:[];
  const validDelta=delta.trim()!==""&&Number.isSafeInteger(change)&&change!==0&&Math.abs(change)<=100000;
  const after=before+(validDelta?change:0);
  const canApply=!!warehouseId&&validDelta&&after>=reserved&&after>=0&&reason.trim().length>=5&&confirm;

  useEffect(()=>{
    let active=true;
    fetch("/api/inventory?productId="+encodeURIComponent(product.id),{cache:"no-store"})
      .then(r=>r.ok?r.json():[]).then(data=>{if(active&&Array.isArray(data))setHistory(data)})
      .catch(()=>{});
    return ()=>{active=false};
  },[product.id,success]);

  function edit(fn:()=>void){fn();setError("");setSuccess("");requestId.current=null;setConfirm(false)}
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!canApply||busy)return;
    setBusy(true);setError("");setSuccess("");
    if(!requestId.current)requestId.current=crypto.randomUUID();
    try{
      const response=await fetch("/api/inventory",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({
          productId:product.id,warehouseId,delta:change,reason:reason.trim(),
          expectedOnHand:before,requestId:requestId.current,
        }),
      });
      const result=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(String(result?.error||"inventory_adjustment_failed"));
      setSuccess("Операция записана. Остаток: "+result.afterOnHand+" шт.");
      setDelta("");setReasonChoice("");setOtherReason("");setConfirm(false);requestId.current=null;
      router.refresh();
    }catch(e){
      const message=e instanceof Error?e.message:String(e);
      setError(message==="stock_changed_refresh"
        ?"Остаток изменился. Обновите карточку и повторите операцию."
        :message==="stock_below_reserved"
        ?"Нельзя уменьшить остаток ниже зарезервированного количества.":message);
    }finally{setBusy(false)}
  }
  return <section className="panel stock-panel">
    <h2>Складские остатки</h2>
    <p className="subtle">Оформляйте приход (+) или списание (−) отдельной операцией. Каждое изменение записывается в журнал. Резервы не редактируются здесь.</p>
    <form onSubmit={submit}>
      <div className="editor-grid">
        <label className="editor-field"><span>Склад</span>
          <select className="input" value={warehouseId}
            onChange={e=>edit(()=>setWarehouseId(e.target.value))}>
            {warehouses.map(w=><option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
          </select></label>
        <div className="editor-field"><span>Текущий остаток и резерв</span>
          <div className="stock-current">{before} шт. · резерв {reserved} · доступно {selected?.available||0}</div></div>
        <label className="editor-field"><span>Изменение количества (например +5 или -2)</span>
          <input className="input" type="number" step="1" value={delta}
            onChange={e=>edit(()=>{
              if(Math.sign(Number(e.target.value))!==Math.sign(change)){
                setReasonChoice("");setOtherReason("");
              }
              setDelta(e.target.value);
            })} required /></label>
        <div className="editor-field"><span>Будет на складе</span>
          <div className="stock-current"><strong>{validDelta?after:"—"} шт.</strong></div></div>
        <label className="editor-field wide"><span>Причина операции (обязательно)</span>
          <select className="input" value={reasonChoice} disabled={!validDelta} required
            onChange={e=>edit(()=>{setReasonChoice(e.target.value);setOtherReason("");})}>
            <option value="">{validDelta?"Выберите причину":"Сначала укажите количество"}</option>
            {reasonOptions.map(item=><option key={item} value={item}>{item}</option>)}
            {validDelta&&<option value="other">Другое</option>}
          </select></label>
        {reasonChoice==="other"&&<label className="editor-field wide"><span>Укажите причину</span>
          <input className="input" value={otherReason} minLength={5} maxLength={500} required
            placeholder="Например: пересчёт после приёмки"
            onChange={e=>edit(()=>setOtherReason(e.target.value))}/></label>}
      </div>
      <label className="review-check stock-confirm">
        <input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>
        Подтверждаю изменение физического остатка на выбранном складе
      </label>
      {error&&<div className="error" role="alert">{error}</div>}
      {success&&<p role="status" className="stock-success">{success}</p>}
      {validDelta&&after<reserved&&<div className="error">Остаток не может быть меньше резерва ({reserved} шт.).</div>}
      <div className="actions" style={{marginTop:12}}>
        <button className="button primary" disabled={!canApply||busy} type="submit">
          {busy?"Сохранение…":"Записать складскую операцию"}</button>
      </div>
    </form>
    <h3 className="stock-history-heading">Последние складские операции</h3>
    {history.length===0?<p className="subtle">Пока нет записанных операций.</p>:
      <div className="list">{history.slice(0,10).map(a=><div className="list-row" key={a.id}>
        <div><strong>{a.delta>0?"+":""}{a.delta} шт. · {a.warehouseCode}</strong>
          <div className="subtle">{a.reason}</div>
          <div className="subtle">{new Date(a.createdAt).toLocaleString("ru-RU")}</div>
        </div><span className="badge">{a.beforeOnHand} → {a.afterOnHand}</span>
      </div>)}</div>}
  </section>;
}
