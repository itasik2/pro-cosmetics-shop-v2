"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Product = { id:string; sku:string; title:string; purchasePrice:number|null; price:number|null };
type Rule = {
  productId:string; channel:string; strategy:string; mode:string; enabled:boolean;
  emergencyStop:boolean; currentOfferPrice:number|null; minPrice:number; maxPrice:number;
  minMarginPercent:number; feePercent:number; shippingCost:number; targetProfit:number;
  step:number; adjustment:number; maxChangePercent:number; maxAgeMinutes:number; cooldownMinutes:number;
  title:string; sku:string;
};
type Quote = { id:string; productId:string; channel:string; seller:string; price:number; sourceType:string; observedAt:string };
type Decision = { id:string; productId:string; channel:string; status:string; reason:string; currentPrice:number|null; competitorPrice:number|null; targetPrice:number|null; createdAt:string };
type Draft = Omit<Rule,"title"|"sku">;
const defaults:Draft={
 productId:"",channel:"KASPI",strategy:"UNDERCUT",mode:"DRY_RUN",enabled:false,
 emergencyStop:true,currentOfferPrice:null,minPrice:1000,maxPrice:100000,
 minMarginPercent:10,feePercent:10,shippingCost:0,targetProfit:0,step:10,
 adjustment:10,maxChangePercent:5,maxAgeMinutes:60,cooldownMinutes:60,
};
const numbers: {key:keyof Draft;label:string;step?:string;min?:number}[]=[
 {key:"currentOfferPrice",label:"Текущая цена в канале, ₸ (обязательно для Kaspi)",min:1},
 {key:"minPrice",label:"Минимальная цена, ₸",min:1},
 {key:"maxPrice",label:"Максимальная цена, ₸",min:1},
 {key:"minMarginPercent",label:"Минимальная маржа, %",step:"0.01",min:0},
 {key:"feePercent",label:"Комиссия канала, %",step:"0.01",min:0},
 {key:"shippingCost",label:"Доставка и расходы, ₸",min:0},
 {key:"targetProfit",label:"Дополнительная прибыль, ₸",min:0},
 {key:"step",label:"Шаг округления, ₸",min:1},
 {key:"adjustment",label:"Ниже конкурента на, ₸",min:0},
 {key:"maxChangePercent",label:"Максимальное изменение за цикл, %",step:"0.01",min:0.01},
 {key:"maxAgeMinutes",label:"Срок актуальности цен, минут",min:1},
 {key:"cooldownMinutes",label:"Пауза между пересчётами, минут",min:0},
];
export function RepricingConsole({products,policies,quotes,decisions}:{
 products:Product[];policies:Rule[];quotes:Quote[];decisions:Decision[]
}){
 const router=useRouter();
 const [form,setForm]=useState<Draft>({...defaults,productId:products[0]?.id||""});
 const [seller,setSeller]=useState("");
 const [quotePrice,setQuotePrice]=useState("");
 const [message,setMessage]=useState("");
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 const selected=products.find(p=>p.id===form.productId);
 function pick(productId:string,channel:string){
   const saved=policies.find(p=>p.productId===productId&&p.channel===channel);
   setForm(saved?{...saved}:{
     ...defaults,productId,channel,
     minPrice:Math.max(1,Math.floor((products.find(p=>p.id===productId)?.price||10000)*.7)),
     maxPrice:Math.max(1,Math.ceil((products.find(p=>p.id===productId)?.price||10000)*1.5)),
   });
 }
 async function call(action:"policy"|"observation"|"evaluate",payload:Record<string,unknown>){
   setBusy(true);setError("");setMessage("");
   try{
     const response=await fetch("/api/repricing",{method:"POST",
       headers:{"content-type":"application/json"},body:JSON.stringify({action,productId:form.productId,channel:form.channel,...payload})});
     const result=await response.json().catch(()=>null);
     if(!response.ok)throw new Error(String(result?.error||"request_failed"));
     if(action==="evaluate")setMessage(
       "Результат: "+result.status+" | причина: "+result.reason+
       (result.targetPrice!=null?" | расчётная цена: "+result.targetPrice+" ₸":"")+
       ". Цена на торговой площадке не менялась.");
     else setMessage(action==="policy"?"Правило сохранено.":"Наблюдение сохранено; оно используется только для расчёта.");
     router.refresh();
   }catch(e){setError(e instanceof Error?e.message:String(e))}
   finally{setBusy(false)}
 }
 return <div className="page">
   <div className="page-head"><div><h1>Мониторинг цен и репрайсер</h1>
     <p>Правила минимальной маржи, границы изменения цены, контроль конкурентов и журнал решений.</p></div></div>
   <section className="panel">
     <h2>Безопасный запуск</h2>
     <p className="subtle">Пока не подключён подтверждённый источник цен конкурентов и не проверен разрешённый механизм публикации в Kaspi, доступно моделирование и создание правил.
     Цены, введённые вручную, не могут запускать автоматическое изменение. Режим AUTO_PROPOSE только готовит предложение и не публикует его на площадке.</p>
   </section>
   <section className="panel" style={{marginTop:14}}>
    <h2>Правило для товара и канала</h2>
    <div className="editor-grid">
     <label className="editor-field"><span>Товар</span><select className="input" value={form.productId} onChange={e=>pick(e.target.value,form.channel)}>
       {products.map(p=><option key={p.id} value={p.id}>{p.sku} — {p.title}</option>)}</select></label>
     <label className="editor-field"><span>Канал продаж</span><select className="input" value={form.channel} onChange={e=>pick(form.productId,e.target.value)}>
       <option value="KASPI">Kaspi</option><option value="STORE">Собственный магазин</option>
       <option value="OZON">Ozon</option><option value="WILDBERRIES">Wildberries</option></select></label>
     <label className="editor-field"><span>Стратегия</span><select className="input" value={form.strategy} onChange={e=>setForm({...form,strategy:e.target.value})}>
       <option value="UNDERCUT">Ниже конкурента на шаг</option><option value="MATCH">Цена конкурента</option><option value="TARGET">Максимальная допустимая цена</option></select></label>
     <label className="editor-field"><span>Режим</span><select className="input" value={form.mode} onChange={e=>setForm({...form,mode:e.target.value})}>
       <option value="DRY_RUN">Только расчёт</option><option value="AUTO_PROPOSE">Автоматическое предложение (без публикации)</option></select></label>
     {numbers.map(f=><label key={f.key} className="editor-field"><span>{f.label}</span>
       <input className="input" type="number" min={f.min??0} step={f.step??"1"}
         value={form[f.key]===null?"":String(form[f.key])}
         onChange={e=>setForm(prev=>({...prev,[f.key]:e.target.value===""?null:Number(e.target.value)}))}/></label>)}
    </div>
    <div className="actions" style={{marginTop:16,flexWrap:"wrap"}}>
      <label className="review-check"><input type="checkbox" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})}/>Включить правило</label>
      <label className="review-check"><input type="checkbox" checked={form.emergencyStop} onChange={e=>setForm({...form,emergencyStop:e.target.checked})}/>Аварийная остановка</label>
    </div>
    <div className="actions" style={{marginTop:16}}>
      <button className="button primary" disabled={busy||!selected} onClick={()=>call("policy",form)}>Сохранить правило</button>
      <button className="button" disabled={busy||!selected} onClick={()=>call("evaluate",{auto:false})}>Рассчитать цену</button>
    </div>
    <p className="subtle">Закупочная цена выбранного товара: {selected?.purchasePrice??"не указана"} ₸. При отсутствии себестоимости расчёт блокируется.</p>
   </section>
   <section className="panel" style={{marginTop:14}}>
     <h2>Наблюдение цены конкурента</h2>
     <p className="subtle">Ручные данные предназначены для тестирования правил. Автоматический мониторинг потребует подключённого доверенного источника.</p>
     <div className="editor-grid">
       <label className="editor-field"><span>Продавец</span><input className="input" value={seller} onChange={e=>setSeller(e.target.value)} maxLength={120}/></label>
       <label className="editor-field"><span>Цена конкурента, ₸</span><input className="input" type="number" min="1" step="1" value={quotePrice} onChange={e=>setQuotePrice(e.target.value)}/></label>
     </div>
     <button className="button" disabled={busy||!seller.trim()||!quotePrice} onClick={()=>call("observation",{seller:seller.trim(),price:Number(quotePrice)})}>Добавить наблюдение</button>
   </section>
   {message&&<div className="panel" style={{marginTop:14}} role="status">{message}</div>}
   {error&&<div className="error" style={{marginTop:14}} role="alert">{error}</div>}
   <div className="two-col" style={{marginTop:14}}>
    <section className="panel"><h2>Последние цены конкурентов</h2>
     {quotes.length===0?<p className="subtle">Наблюдений нет.</p>:
       <div className="list">{quotes.slice(0,25).map(q=><div className="list-row" key={q.id}>
         <div><strong>{q.seller}</strong><div className="subtle">{q.channel} · {new Date(q.observedAt).toLocaleString("ru-RU")}</div></div>
         <span className="badge">{q.price.toLocaleString("ru-RU")} ₸</span></div>)}</div>}</section>
    <section className="panel"><h2>Журнал расчётов</h2>
     {decisions.length===0?<p className="subtle">Расчётов пока нет.</p>:
       <div className="list">{decisions.slice(0,25).map(d=><div className="list-row" key={d.id}>
         <div><strong>{d.status}</strong><div className="subtle">{d.channel} · {d.reason} · {new Date(d.createdAt).toLocaleString("ru-RU")}</div></div>
         <span className="badge">{d.targetPrice===null?"—":d.targetPrice.toLocaleString("ru-RU")+" ₸"}</span></div>)}</div>}</section>
   </div>
 </div>;
}
