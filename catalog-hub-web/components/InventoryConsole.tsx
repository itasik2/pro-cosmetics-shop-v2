"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CoreProductPicker } from "./CoreProductPicker";
import { InventoryReconciliation } from "./InventoryReconciliation";
import { coreMessage, coreRequest, type CoreBalance, type CoreProduct, type CoreWarehouse } from "@/lib/core-client";
type Movement = { id:string; sku:string; kind:string; deltaOnHand:number; deltaReserved:number; afterOnHand:number; afterReserved:number; reason:string; createdAt:string; warehouseName:string };
const kinds:Record<string,string> = { RECEIVE:"Приход",WRITE_OFF:"Списание",COUNT:"Инвентаризация",TRANSFER:"Перемещение",RESERVE:"Резерв",RELEASE:"Снятие резерва",SHIP:"Отгрузка",RETURN:"Возврат" };

export function InventoryConsole({ products,warehouses,movements,defaultWarehouseId }: { products:CoreProduct[];warehouses:CoreWarehouse[];movements:Movement[];defaultWarehouseId?:string }) {
  const router=useRouter();
  const [productId,setProduct]=useState("");
  const [warehouseId,setWarehouse]=useState(warehouses.find(w=>w.id===defaultWarehouseId)?.id || warehouses[0]?.id || "");
  const [target,setTarget]=useState("");
  const [kind,setKind]=useState("RECEIVE");
  const [quantity,setQuantity]=useState("1");
  const [reason,setReason]=useState("");
  const [preview,setPreview]=useState<{ source:CoreBalance; destination?:CoreBalance } | null>(null);
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const key=useRef<string | null>(null);
  const warehouseOperation=useRef<{signature:string;key:string}|null>(null);
  function edit(action:()=>void) { action();setPreview(null);setConfirmed(false);key.current=null;setError("");setMessage(""); }
  async function inspect() {
    setBusy(true);setError("");setMessage("");key.current=null;setConfirmed(false);
    try {
      const data=await coreRequest<{items:CoreBalance[]}>("inventory/balances?productId="+encodeURIComponent(productId));
      const empty={productId,warehouseId,onHand:0,reserved:0,safetyStock:0,available:0,revision:0,sku:"",warehouseName:""};
      setPreview({source:data.items.find(i=>i.warehouseId===warehouseId) || empty,
        ...(kind==="TRANSFER"?{destination:data.items.find(i=>i.warehouseId===target) || {...empty,warehouseId:target}}:{})});
    } catch(e) { setError(coreMessage(e)); } finally {setBusy(false);}
  }
  async function apply() {
    if(!preview || !confirmed || busy)return;
    setBusy(true);setError("");
    key.current ||= crypto.randomUUID();
    try {
      await coreRequest("inventory/movements",{productId,warehouseId,kind,quantity:Number(quantity),reason,
        expectedRevision:preview.source.revision,...(kind==="TRANSFER"?{targetWarehouseId:target,targetExpectedRevision:preview.destination?.revision}: {})},key.current);
      setMessage("Движение сохранено в журнале.");setPreview(null);setConfirmed(false);key.current=null;router.refresh();
    }catch(e){setError(coreMessage(e));}finally{setBusy(false);}
  }
  async function addWarehouse(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(busy)return;const data=new FormData(e.currentTarget),body={name:data.get("warehouseName"),code:data.get("warehouseCode")};
    const signature=JSON.stringify(body);if(warehouseOperation.current?.signature!==signature)warehouseOperation.current={signature,key:crypto.randomUUID()};
    setBusy(true);setError("");setMessage("");
    try{await coreRequest("inventory/warehouses",body,warehouseOperation.current.key);setMessage("Склад добавлен.");router.refresh();}
    catch(e){setError(coreMessage(e));}finally{setBusy(false);}
  }
  const count=Number(quantity),after=preview?kind==="COUNT"?count:preview.source.onHand+(kind==="RECEIVE"?count:-count):0;
  const valid=!!productId&&!!warehouseId&&Number.isSafeInteger(count)&&count>=(kind==="COUNT"?0:1)&&count<=100000&&reason.trim().length>=5&&
    (kind!=="TRANSFER" || !!target&&target!==warehouseId);
  return <>
    <section className="panel"><h2>Складская операция</h2><fieldset disabled={busy} className="core-form">
      <CoreProductPicker products={products} value={productId} onChange={id=>edit(()=>setProduct(id))} />
      <label>Склад<select className="input" value={warehouseId} onChange={e=>edit(()=>setWarehouse(e.target.value))}>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <label>Операция<select className="input" value={kind} onChange={e=>edit(()=>setKind(e.target.value))}>{["RECEIVE","WRITE_OFF","COUNT","TRANSFER"].map(k=><option key={k} value={k}>{kinds[k]}</option>)}</select></label>
      {kind==="TRANSFER"&&<label>Склад назначения<select className="input" value={target} onChange={e=>edit(()=>setTarget(e.target.value))}><option value="">Выберите склад</option>{warehouses.filter(w=>w.id!==warehouseId).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
      <label>{kind==="COUNT"?"Фактическое количество":"Количество"}<input className="input" type="number" min={kind==="COUNT"?0:1} max={100000} value={quantity} onChange={e=>edit(()=>setQuantity(e.target.value))} /></label>
      <label>Основание<input className="input" value={reason} minLength={5} maxLength={500} onChange={e=>edit(()=>setReason(e.target.value))} placeholder="Номер документа и причина" /></label>
    </fieldset><div className="actions"><button className="button" disabled={!valid||busy} onClick={()=>void inspect()}>Проверить операцию</button></div>
      {preview&&<div className="core-preview"><p>На складе: <strong>{preview.source.onHand} → {after}</strong>. В резерве: {preview.source.reserved}.</p>
        {kind==="TRANSFER"&&<p>На складе назначения: {preview.destination?.onHand} → {(preview.destination?.onHand||0)+count}.</p>}
        <label className="core-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} /> Подтверждаю количество и основание</label>
        <button className="button primary" disabled={!confirmed||busy||after<preview.source.reserved} onClick={()=>void apply()}>{busy?"Сохранение…":"Записать движение"}</button></div>}
      {error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status" className="core-success">{message}</p>}
    </section>
    <details className="panel core-section"><summary>Добавить склад</summary><form onSubmit={addWarehouse}><fieldset className="core-form core-section" disabled={busy}>
      <label>Название склада<input className="input" name="warehouseName" required maxLength={128} /></label>
      <label>Код склада<input className="input" name="warehouseCode" required maxLength={32} placeholder="Например, SKLAD-2" /></label>
      <button className="button" type="submit">Добавить склад</button>
    </fieldset></form></details>
    <InventoryReconciliation />
    <section className="panel core-section"><h2>Журнал движений</h2>{!movements.length?<p className="subtle">Движений пока нет.</p>:<div className="table-wrap"><table><thead><tr><th>Дата</th><th>SKU / склад</th><th>Операция</th><th>Изменение</th><th>Итог / резерв</th><th>Основание</th></tr></thead><tbody>{movements.map(m=><tr key={m.id}>
      <td>{new Date(m.createdAt).toLocaleString("ru-RU")}</td><td>{m.sku}<div className="subtle">{m.warehouseName}</div></td><td>{kinds[m.kind]||m.kind}</td><td>{m.deltaOnHand>0?"+":""}{m.deltaOnHand}<div className="subtle">Резерв: {m.deltaReserved>0?"+":""}{m.deltaReserved}</div></td><td>{m.afterOnHand} / {m.afterReserved}</td><td>{m.reason}</td>
    </tr>)}</tbody></table></div>}</section>
  </>;
}
export type {Movement};
