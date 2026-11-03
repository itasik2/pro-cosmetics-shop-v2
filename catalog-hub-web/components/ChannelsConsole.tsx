"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CoreProductPicker } from "./CoreProductPicker";
import { coreMessage,coreRequest,type CoreConnection,type CoreProduct,type CoreWarehouse } from "@/lib/core-client";
type Offer={productId:string;sellerSku:string;price:number|null;channelBuffer:number;preorderDays:number|null;version:number};
type Feed={xml:string;count:number;checksum:string;deliveryStatus:string};
const modes:Record<string,string>={SHADOW:"Сравнение",ACTIVE:"Включён",PAUSED:"Приостановлен"};

export function ChannelsConsole({connections,products,warehouses}:{connections:CoreConnection[];products:CoreProduct[];warehouses:CoreWarehouse[]}){
  const router=useRouter();
  const [selected,setSelected]=useState(connections[0]?.id||"");
  const [productId,setProduct]=useState("");
  const [offer,setOffer]=useState<Offer|null>(null),[offerLoading,setOfferLoading]=useState(false);
  const [sellerSku,setSellerSku]=useState(""),[price,setPrice]=useState(""),[buffer,setBuffer]=useState("0"),[preorder,setPreorder]=useState("");
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const [feed,setFeed]=useState<Feed|null>(null);
  const operation=useRef<{payload:string;key:string}|null>(null);
  const current=connections.find(c=>c.id===selected);
  useEffect(()=>{
    setOffer(null);setSellerSku("");setPrice("");setBuffer("0");setPreorder("");setFeed(null);
    if(!selected||!productId)return;
    const controller=new AbortController();setOfferLoading(true);
    void coreRequest<Offer[]>(`channels/${selected}/offers?productId=${encodeURIComponent(productId)}`,undefined,undefined,controller.signal)
      .then(rows=>{const found=rows.find(o=>o.productId===productId)||null;setOffer(found);setSellerSku(found?.sellerSku||"");setPrice(found?.price?.toString()||"");setBuffer(String(found?.channelBuffer||0));setPreorder(found?.preorderDays?.toString()||"");})
      .catch(e=>{if(!controller.signal.aborted)setError(coreMessage(e));}).finally(()=>{if(!controller.signal.aborted)setOfferLoading(false);});
    return()=>controller.abort();
  },[selected,productId]);
  async function mutate<T>(path:string,body:unknown):Promise<T>{
    const payload=JSON.stringify({path,body});
    if(operation.current?.payload!==payload)operation.current={payload,key:crypto.randomUUID()};
    return coreRequest<T>(path,body,operation.current.key);
  }
  async function create(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const form=new FormData(e.currentTarget);setBusy(true);setError("");setMessage("");
    try{const created=await mutate<CoreConnection>("channels",{name:form.get("name"),adapter:form.get("adapter"),environment:form.get("environment")});
      setSelected(created.id);setMessage("Канал добавлен в режиме сравнения.");router.refresh();
    }catch(e){setError(coreMessage(e));}finally{setBusy(false);}
  }
  async function mode(next:string){
    if(!current)return;setBusy(true);setError("");
    try{await mutate(`channels/${current.id}/mode`,{mode:next,expectedVersion:current.version,confirmed});setConfirmed(false);setMessage("Режим канала обновлён.");router.refresh();}
    catch(e){setError(coreMessage(e));}finally{setBusy(false);}
  }
  async function saveOffer(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!current)return;setBusy(true);setError("");
    try{const saved=await mutate<Offer>(`channels/${current.id}/offers`,{productId,sellerSku,price:price===""?null:Number(price),
      channelBuffer:Number(buffer),preorderDays:preorder===""?null:Number(preorder),expectedVersion:offer?.version||0});
      setOffer(saved);setFeed(null);setMessage("Предложение сохранено.");router.refresh();
    }catch(e){setError(coreMessage(e));}finally{setBusy(false);}
  }
  async function saveMappings(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!current)return;const form=new FormData(e.currentTarget);setBusy(true);setError("");
    try{await mutate(`channels/${current.id}/mappings`,{expectedVersion:current.version,
      warehouses:[{warehouseId:form.get("warehouseId"),externalId:form.get("externalId")}],
      ...(current.adapter==="KASPI_XML"?{settings:{company:form.get("company"),merchantId:form.get("merchantId"),
        expectedSellerSkus:String(form.get("skus")||"").split(/[\s,;]+/).filter(Boolean)}}:{})});
      setFeed(null);setMessage("Сопоставления сохранены.");router.refresh();
    }catch(e){setError(coreMessage(e));}finally{setBusy(false);}
  }
  async function previewFeed(){
    if(!current)return;setBusy(true);setError("");setFeed(null);
    try{setFeed(await coreRequest<Feed>(`channels/${current.id}/feed-preview`));}catch(e){setError(coreMessage(e));}finally{setBusy(false);}
  }
  function download(){if(!feed)return;const url=URL.createObjectURL(new Blob([feed.xml],{type:"application/xml"}));const a=document.createElement("a");a.href=url;a.download="kaspi-catalog.xml";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <>
    <section className="panel"><h2>Добавить подключение</h2><form onSubmit={create}><fieldset className="core-form" disabled={busy}>
      <label>Название<input className="input" name="name" required maxLength={128} placeholder="Мой интернет-магазин" /></label>
      <label>Канал<select className="input" name="adapter"><option value="OWN_STORE">Собственный магазин</option><option value="KASPI_XML">Kaspi · XML</option><option value="GENERIC_ERP">ERP · экспорт каталога</option></select></label>
      <label>Окружение<select className="input" name="environment"><option value="TEST">Тестовое</option><option value="PRODUCTION">Рабочее · режим сравнения</option></select></label>
      <button className="button primary" type="submit">Добавить канал</button>
    </fieldset></form></section>
    {error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status" className="core-success">{message}</p>}
    <section className="panel core-section"><h2>Подключения</h2>{!connections.length?<p className="subtle">Подключений пока нет.</p>:<>
      <label className="core-field">Выбранный канал<select className="input" value={selected} onChange={e=>{setSelected(e.target.value);setConfirmed(false);setError("");setMessage("");}} disabled={busy}>{connections.map(c=><option key={c.id} value={c.id}>{c.name} · {c.environment==="TEST"?"тест":"рабочий"} · {modes[c.mode]||c.mode}</option>)}</select></label>
      {current&&<><p><span className="badge">{current.adapter}</span> <span className="badge">{modes[current.mode]||current.mode}</span> · Предложений: {current.offerCount}</p>
      {current.adapter==="OWN_STORE"&&<div className="core-preview"><label className="core-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)} /> Подтверждаю изменение режима</label>
        <div className="actions">{["SHADOW","PAUSED",...(current.environment==="TEST"?["ACTIVE"]:[])].map(next=><button className="button" disabled={busy||!confirmed||current.mode===next} key={next} onClick={()=>void mode(next)}>{modes[next]}</button>)}</div>
      </div>}
      <div className="two-col"><form className="panel" onSubmit={saveOffer}><h2>Предложение товара</h2><fieldset className="core-form single" disabled={busy}>
        <CoreProductPicker products={products} value={productId} onChange={setProduct} />
        <label>SKU в канале<input className="input" value={sellerSku} required maxLength={current.adapter==="KASPI_XML"?20:128} onChange={e=>setSellerSku(e.target.value)} /></label>
        <label>Цена в канале, ₸<input className="input" type="number" min={1} value={price} onChange={e=>setPrice(e.target.value)} placeholder="Базовая цена товара" /></label>
        <label>Страховой запас канала<input className="input" type="number" min={0} max={100000} value={buffer} onChange={e=>setBuffer(e.target.value)} /></label>
        {current.adapter==="KASPI_XML"&&<label>Предзаказ, дней<input className="input" type="number" min={1} max={30} value={preorder} onChange={e=>setPreorder(e.target.value)} placeholder="Без предзаказа" /></label>}
        <button className="button primary" disabled={!productId||offerLoading} type="submit">{offerLoading?"Загрузка…":"Сохранить предложение"}</button>
      </fieldset></form>
      <form className="panel" onSubmit={saveMappings} key={current.id+":"+current.version}><h2>Склад и параметры канала</h2><fieldset className="core-form single" disabled={busy}>
        <label>Склад Catalog Hub<select className="input" name="warehouseId" required>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <label>Код склада в канале<input className="input" name="externalId" required maxLength={128} placeholder={current.adapter==="KASPI_XML"?"Например, PP1":"Код склада магазина"} /></label>
        {current.adapter==="KASPI_XML"&&<><label>Компания<input className="input" name="company" required defaultValue={current.settings?.company||""} maxLength={200} /></label>
          <label>Merchant ID<input className="input" name="merchantId" required defaultValue={current.settings?.merchantId||""} maxLength={128} /></label>
          <label>Полный ожидаемый список SKU<textarea className="input" name="skus" required rows={5} defaultValue={current.settings?.expectedSellerSkus?.join("\n")||""} placeholder="По одному SKU на строку" /></label></>}
        <button className="button" type="submit">Сохранить сопоставление</button>
      </fieldset></form></div>
      {current.adapter==="KASPI_XML"&&<div className="core-preview"><h2>Проверка полного XML</h2><button className="button" disabled={busy} onClick={()=>void previewFeed()}>Проверить и подготовить XML</button>
        {feed&&<><p>Проверено предложений: <strong>{feed.count}</strong>. Файл подготовлен и ещё не отправлен в магазин.</p><button className="button primary" onClick={download}>Скачать XML</button><details><summary>Содержимое файла</summary><pre className="core-code">{feed.xml}</pre></details></>}
      </div>}
      </>}
    </>}</section>
  </>;
}
