"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CoreProductPicker } from "./CoreProductPicker";
import { coreMessage, coreRequest, type CoreConnection, type CoreOrder, type CoreProduct, type CoreWarehouse } from "@/lib/core-client";
const statuses:Record<string,string>={RESERVED:"В резерве",CANCELED:"Отменён",SHIPPED:"Отгружен",PARTIALLY_RETURNED:"Частичный возврат",RETURNED:"Возвращён"};
type Preview={canReserve:boolean;checks:Array<{productId:string;quantity:number;available:number;canReserve:boolean}>};

export function OrdersConsole({ orders,connections,products,warehouses }: {
  orders:CoreOrder[];connections:CoreConnection[];products:CoreProduct[];warehouses:CoreWarehouse[];
}) {
  const router=useRouter();
  const [connectionId,setConnection]=useState(connections.find(c=>c.adapter==="OWN_STORE")?.id||"");
  const [externalOrderId,setExternalId]=useState("");
  const [productId,setProduct]=useState("");
  const [warehouseId,setWarehouse]=useState(warehouses[0]?.id||"");
  const [quantity,setQuantity]=useState("1");
  const [preview,setPreview]=useState<Preview|null>(null);
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const [pending,setPending]=useState<{order:CoreOrder;type:string}|null>(null);
  const identity=useRef<{key:string;eventId:string}|null>(null);
  function edit(action:()=>void){action();setPreview(null);setPending(null);setConfirmed(false);identity.current=null;setError("");setMessage("");}
  const connection=connections.find(c=>c.id===connectionId);
  const count=Number(quantity),valid=!!connectionId&&externalOrderId.trim().length>0&&!!productId&&!!warehouseId&&Number.isSafeInteger(count)&&count>0&&count<=100000;
  function event() { return { connectionId,externalOrderId:externalOrderId.trim(),externalEventId:"preview",type:"CREATED",items:[{productId,warehouseId,quantity:count}] }; }
  async function inspect(){
    setBusy(true);setError("");identity.current=null;setPending(null);setConfirmed(false);
    try{setPreview(await coreRequest<Preview>("orders/events/preview",event()));}catch(e){setError(coreMessage(e));}finally{setBusy(false);}
  }
  async function applyNew(){
    if(!preview?.canReserve||!confirmed||busy)return;
    setBusy(true);setError("");
    identity.current ||= {key:crypto.randomUUID(),eventId:crypto.randomUUID()};
    try{
      await coreRequest("orders/events",{...event(),externalEventId:identity.current.eventId},identity.current.key);
      setMessage("Заказ сохранён. Товары зарезервированы.");setPreview(null);setConfirmed(false);identity.current=null;setExternalId("");router.refresh();
    }catch(e){setError(coreMessage(e));}finally{setBusy(false);}
  }
  async function transition(){
    if(!pending||!confirmed||busy)return;
    setBusy(true);setError("");
    identity.current ||= {key:crypto.randomUUID(),eventId:crypto.randomUUID()};
    try{
      await coreRequest("orders/events",{connectionId:pending.order.connectionId,externalOrderId:pending.order.externalOrderId,
        externalEventId:identity.current.eventId,type:pending.type},identity.current.key);
      setMessage("Статус заказа и склад обновлены.");setPending(null);setConfirmed(false);identity.current=null;router.refresh();
    }catch(e){setError(coreMessage(e));}finally{setBusy(false);}
  }
  const transitionLabel=pending?.type==="SHIPPED"?"Отгрузить":pending?.type==="CANCELED"?"Отменить заказ":"Вернуть все оставшиеся позиции";
  return <>
    <section className="panel"><h2>Проверка входящего заказа</h2>
      {!connections.some(c=>c.adapter==="OWN_STORE")?<p>Сначала добавьте собственный магазин в разделе «Каналы».</p>:<>
      <fieldset disabled={busy} className="core-form">
        <label>Магазин<select className="input" value={connectionId} onChange={e=>edit(()=>setConnection(e.target.value))}>{connections.filter(c=>c.adapter==="OWN_STORE").map(c=><option value={c.id} key={c.id}>{c.name} · {c.environment==="TEST"?"тест":"рабочий"}</option>)}</select></label>
        <label>Номер заказа магазина<input className="input" value={externalOrderId} maxLength={128} onChange={e=>edit(()=>setExternalId(e.target.value))} /></label>
        <CoreProductPicker products={products} value={productId} onChange={id=>edit(()=>setProduct(id))} />
        <label>Склад<select className="input" value={warehouseId} onChange={e=>edit(()=>setWarehouse(e.target.value))}>{warehouses.map(w=><option value={w.id} key={w.id}>{w.name}</option>)}</select></label>
        <label>Количество<input className="input" type="number" min={1} max={100000} value={quantity} onChange={e=>edit(()=>setQuantity(e.target.value))} /></label>
      </fieldset>
      <button className="button" disabled={!valid||busy} onClick={()=>void inspect()}>Проверить свободный остаток</button>
      {preview&&<div className="core-preview"><p>Запрошено: <strong>{count}</strong>. Доступно: <strong>{preview.checks[0]?.available??0}</strong>.</p>
        {connection?.mode!=="ACTIVE"?<p className="subtle">Режим сравнения: склад остаётся без изменений. Для теста резерва включите тестовый канал.</p>:<>
        <label className="core-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} /> Подтверждаю резерв заказа</label>
        <button className="button primary" disabled={!preview.canReserve||!confirmed||busy} onClick={()=>void applyNew()}>Создать резерв</button></>}
      </div>}</>}
    </section>
    {error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status" className="core-success">{message}</p>}
    {pending&&<section className="panel core-section"><h2>{transitionLabel}: {pending.order.externalOrderId}</h2>
      <p>{pending.type==="CANCELED"?"Резерв будет снят.":pending.type==="SHIPPED"?"Количество будет списано со склада, резерв снят.":"Все ещё не возвращённые позиции будут приняты на склад."}</p>
      <label className="core-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy} /> Подтверждаю действие</label>
      <div className="actions"><button className="button primary" disabled={!confirmed||busy} onClick={()=>void transition()}>{transitionLabel}</button><button className="button" disabled={busy} onClick={()=>{setPending(null);setConfirmed(false);identity.current=null;}}>Закрыть</button></div>
    </section>}
    <section className="panel core-section"><h2>Заказы</h2>{!orders.length?<p className="subtle">Заказов пока нет.</p>:<div className="table-wrap"><table><thead><tr><th>Заказ / канал</th><th>Позиции</th><th>Статус</th><th>Действие</th></tr></thead><tbody>{orders.map(order=><tr key={order.id}>
      <td><strong>{order.externalOrderId}</strong><div className="subtle">{order.channelName}</div></td><td>{order.items.map(item=><div key={item.productId+item.warehouseId}>{item.sku}: {item.quantity} шт.{item.returned>0?` · возвращено ${item.returned}`:""}</div>)}</td>
      <td><span className="badge">{statuses[order.status]||order.status}</span></td><td><div className="actions">{(order.status==="RESERVED"?[['SHIPPED','Отгрузить'],['CANCELED','Отменить']]:["SHIPPED","PARTIALLY_RETURNED"].includes(order.status)?[['RETURNED','Возврат']]:[]).map(([type,label])=><button className="button" disabled={busy} key={type} onClick={()=>{setPending({order,type});setPreview(null);setConfirmed(false);identity.current=null;setError("");}}>{label}</button>)}</div></td>
    </tr>)}</tbody></table></div>}</section>
  </>;
}
