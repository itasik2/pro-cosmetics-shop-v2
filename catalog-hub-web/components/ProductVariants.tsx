"use client";
import Link from "next/link";
import {useRef, useState} from "react";
import {useRouter} from "next/navigation";
import {CoreProductPicker} from "@/components/CoreProductPicker";
import {coreMessage,coreRequest} from "@/lib/core-client";
import type {HubProduct} from "@/lib/hub";
import {money} from "@/lib/format";

type Variant={id:string;sku:string;title:string;attributes:unknown;images:unknown;price:number|null;purchasePrice:number|null;available?:number};
export type VariantFamily={masterProductId:string;variants:Variant[];lastGrouping:{id:string;status:string;reason:string}|null};
type Preview={masterProductId:string;title:string;reason:string;fingerprint:string;variants:Variant[];conflicts:Array<{sku:string;fields:string[]}>};
function pack(value:unknown) {
  let parsed=value;
  if(typeof parsed==="string"){try{parsed=JSON.parse(parsed);}catch{return "Фасовка не указана";}}
  if(parsed && typeof parsed==="object"){
    const a=parsed as Record<string,unknown>;
    if(a.volumeValue&&a.volumeUnit)return `${a.volumeValue} ${a.volumeUnit}`;
  }
  return "Фасовка не указана";
}
const labels:Record<string,string>={brand:"бренд",categoryKey:"категория",shortDescription:"краткое описание",description:"описание",application:"применение",ingredients:"состав"};

export function ProductVariants({product,initial,canWrite}:{product:HubProduct;initial:VariantFamily;canWrite:boolean}) {
  const router=useRouter();
  const [family,setFamily]=useState(initial),[selected,setSelected]=useState<Variant[]>(initial.variants);
  const [candidate,setCandidate]=useState(""),[master,setMaster]=useState(initial.masterProductId);
  const [title,setTitle]=useState(product.title),[reason,setReason]=useState("");
  const [preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const operationKey=useRef(crypto.randomUUID()),undoKey=useRef(crypto.randomUUID());
  const grouped=family.variants.length>1;
  function invalidate(){setPreview(null);setError("");setSuccess("");operationKey.current=crypto.randomUUID();}
  async function refresh(){
    setFamily(await coreRequest<VariantFamily>("catalog/variants/"+encodeURIComponent(product.id)));
    router.refresh();
  }
  async function add(){
    if(!candidate||selected.some(v=>v.id===candidate))return;
    setBusy(true);setError("");
    try{
      const item=await coreRequest<HubProduct>("catalog/products/"+encodeURIComponent(candidate));
      setSelected(previous=>[...previous,item]);setCandidate("");invalidate();
    }catch(e){setError(coreMessage(e));}finally{setBusy(false);}
  }
  async function review(){
    setBusy(true);setError("");
    try{setPreview(await coreRequest<Preview>("catalog/variants/preview",{productIds:selected.map(v=>v.id),masterProductId:master,title,reason}));}
    catch(e){setError(coreMessage(e));}finally{setBusy(false);}
  }
  async function apply(){
    if(!preview || !window.confirm(`Объединить ${preview.variants.length} SKU в карточку «${preview.title}»? Общие тексты будут взяты из выбранной карточки.`))return;
    setBusy(true);setError("");
    try{
      await coreRequest("catalog/variants/apply",{productIds:selected.map(v=>v.id),masterProductId:master,title,reason,
        fingerprint:preview.fingerprint,confirmed:true,conflictsAcknowledged:true},operationKey.current);
      setPreview(null);setSuccess("Варианты объединены. SKU и индивидуальные данные сохранены.");await refresh();
    }catch(e){setError(coreMessage(e));}finally{setBusy(false);}
  }
  async function undo(){
    if(!family.lastGrouping||!window.confirm("Отменить объединение и восстановить отдельные карточки? Последующие изменения карточек могут заблокировать откат."))return;
    setBusy(true);setError("");
    try{
      await coreRequest("catalog/variants/groupings/"+encodeURIComponent(family.lastGrouping.id)+"/undo",{confirmed:true},undoKey.current);
      setSuccess("Объединение отменено.");await refresh();
    }catch(e){setError(coreMessage(e));}finally{setBusy(false);}
  }
  return <section className="panel" style={{marginBottom:16}}>
    <h2>Варианты товара</h2>
    <p className="subtle">Общие название, бренд, категория и тексты — в одной карточке. У каждого варианта собственные SKU, фасовка, цены, фото и остатки.</p>
    {product.masterProductId && <p><Link href={"/catalog/"+family.masterProductId}>Открыть общую карточку →</Link></p>}
    <div className="table-wrap"><table><thead><tr><th>Вариант</th><th>Фасовка</th><th>Цена</th><th>Доступно</th></tr></thead>
      <tbody>{family.variants.map(item=><tr key={item.id}><td><Link href={"/catalog/"+item.id}>{item.sku}</Link>{item.id===family.masterProductId&&<span className="badge">Общая карточка</span>}</td>
        <td>{pack(item.attributes)}</td><td>{money(item.price)}</td><td>{item.available??"—"}</td></tr>)}</tbody></table></div>
    {!grouped&&<details style={{marginTop:14}}><summary>Объединить с другими вариантами</summary>
      <p>Добавьте проверенные SKU одного товара и выберите карточку, из которой берутся общие тексты. Разные фасовки сохраняются отдельно.</p>
      <CoreProductPicker products={[]} value={candidate} onChange={setCandidate}/>
      <button className="button" type="button" disabled={!canWrite||busy||!candidate||selected.length>=50} onClick={()=>void add()}>Добавить вариант</button>
      <ul>{selected.map(item=><li key={item.id}>{item.sku} · {item.title}{item.id!==product.id&&<button className="button" type="button" disabled={busy} onClick={()=>{
        setSelected(previous=>previous.filter(v=>v.id!==item.id));if(master===item.id)setMaster(product.id);invalidate();
      }}>Убрать</button>}</li>)}</ul>
      <div className="core-grid">
        <label className="core-field">Источник общих полей<select className="input" value={master} disabled={busy} onChange={e=>{setMaster(e.target.value);invalidate();}}>{selected.map(item=><option key={item.id} value={item.id}>{item.sku} · {item.title}</option>)}</select></label>
        <label className="core-field">Общее название без SKU и фасовки<input className="input" value={title} maxLength={500} disabled={busy} onChange={e=>{setTitle(e.target.value);invalidate();}}/></label>
        <label className="core-field">Основание объединения<input className="input" value={reason} maxLength={1000} disabled={busy} onChange={e=>{setReason(e.target.value);invalidate();}}/></label>
      </div>
      <button className="button" type="button" disabled={!canWrite||busy||selected.length<2||!title.trim()||!reason.trim()} onClick={()=>void review()}>Проверить объединение ({selected.length})</button>
      {preview&&<div className="panel" style={{marginTop:12}}><h3>Предпросмотр объединения</h3>
        <p>{preview.title} · {preview.variants.length} SKU. Общие поля берутся из {selected.find(v=>v.id===master)?.sku}.</p>
        {preview.conflicts.length>0&&<div role="status"><p>Следующие поля отличаются. Их исходные значения сохранятся в истории, в общей карточке будет показан выбранный источник:</p>
          <ul>{preview.conflicts.map(c=><li key={c.sku}>{c.sku}: {c.fields.map(f=>labels[f]||f).join(", ")}</li>)}</ul></div>}
        <p className="subtle">Цены, фото, склады, заказы, ссылки поставщиков и канальные SKU сохраняются.</p>
        <button className="button primary" type="button" disabled={!canWrite||busy} onClick={()=>void apply()}>Подтвердить объединение</button>
      </div>}
    </details>}
    {grouped&&family.lastGrouping?.status==="ACTIVE"&&<div style={{marginTop:12}}>
      <p className="subtle">Основание: {family.lastGrouping.reason}</p><button className="button" type="button" disabled={!canWrite||busy} onClick={()=>void undo()}>Отменить объединение</button>
    </div>}
    {success&&<p role="status" className="stock-success">{success}</p>}
    {error&&<p role="alert" className="error">{error}</p>}
  </section>;
}
