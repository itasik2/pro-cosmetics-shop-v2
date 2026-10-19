"use client";

import { useState } from "react";
import Link from "next/link";
import { enrichmentErrorMessage } from "@/lib/enrichment-messages";
import type { HubProduct } from "@/lib/hub";

type Field = "shortDescription" | "description" | "application" | "ingredients";
type Result = {
  sourceUrl:string;sourceType:string;confidence:number;
  fields:Record<Field,string>;images:string[];warnings:string[];
};
const fields: Array<[Field,string]> = [
  ["shortDescription","Краткое описание"], ["description","Описание"],
  ["application","Применение"], ["ingredients","Состав"],
];

export function SharedProductSearch({product,enabled,canWrite}:{
  product:HubProduct;enabled:boolean;canWrite:boolean;
}) {
  const [sourceUrl,setSourceUrl]=useState("");
  const [external,setExternal]=useState(false);
  const [result,setResult]=useState<Result|null>(null);
  const [draft,setDraft]=useState<Record<Field,string>|null>(null);
  const [selected,setSelected]=useState<Field[]>([]);
  const [image,setImage]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [changeset,setChangeset]=useState("");
  async function search(){
    setBusy(true);setError("");setResult(null);setChangeset("");
    try{
      const response=await fetch("/api/ai/shared-preview",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({productId:product.id,sourceUrl,allowExternalSearch:external}),
      });
      const data=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(String(data?.error||"shared_search_failed"));
      const found=data as Result;
      setResult(found);setDraft({...found.fields});
      setSelected(fields.filter(([key])=>!product[key]?.trim()&&Boolean(found.fields[key])).map(([key])=>key));
      setImage("");
    }catch(e){setError(enrichmentErrorMessage(e));}
    finally{setBusy(false);}
  }
  async function stage(){
    if(!result||!draft)return;
    const proposed:Record<string,unknown>={};
    for(const key of selected){
      if(!product[key]?.trim()&&draft[key].trim())proposed[key]=draft[key].trim();
    }
    if(!product.images?.length&&image)proposed.images=[image];
    if(!Object.keys(proposed).length){setError("Выберите данные для сохранения.");return;}
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/catalog/changes",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({productId:product.id,proposed}),
      });
      const data=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(String(data?.error||"changeset_failed"));
      setChangeset(String(data.id));
    }catch(e){setError(enrichmentErrorMessage(e));}
    finally{setBusy(false);}
  }
  const missing=fields.filter(([key])=>!product[key]?.trim()).map(([,label])=>label);
  if(!product.images?.length)missing.push("Фотографии");
  return <section className="panel">
    <h2>Заполнить пустые поля и подобрать фото</h2>
    <p className="subtle">Не заполнено: {missing.join(", ")||"основные поля заполнены"}. Поиск использует сервис ProCosmetics; результат сначала поступает на проверку.</p>
    {!enabled&&<p className="error" role="status">Поиск ещё не подключён: настройте адрес сервиса и общий серверный ключ.</p>}
    <div className="actions" style={{alignItems:"end"}}>
      <label className="editor-field" style={{minWidth:260,flex:1}}><span>Ссылка на товар (необязательно)</span>
        <input className="input" type="url" value={sourceUrl} onChange={event=>setSourceUrl(event.target.value)}
          placeholder="https://manufacturer.example/product" /></label>
      <button className="button primary" type="button" disabled={!enabled||!canWrite||busy||!missing.length}
        onClick={()=>void search()}>{busy?"Поиск…":"Найти и предложить"}</button>
    </div>
    <label className="review-check"><input type="checkbox" checked={external}
      onChange={event=>setExternal(event.target.checked)}/>
      Если производитель не найден, искать у других продавцов</label>
    {!canWrite&&<p className="subtle">Локальный режим чтения: сохранение отключено.</p>}
    {error&&<p className="error" role="alert">{error}</p>}
    {changeset&&<p role="status">Черновик создан. <Link href={"/changes/"+encodeURIComponent(changeset)}>Проверить изменения →</Link></p>}
    {result&&draft&&<div className="panel" style={{marginTop:14}}>
      <h3>Предложение · {result.confidence}% совпадения</h3>
      <p>Источник: <a href={result.sourceUrl} target="_blank" rel="noreferrer">{result.sourceUrl}</a></p>
      <p className="subtle">{result.sourceType==="official_unverified"
        ?"Официальный сайт найден автоматически. Проверьте принадлежность бренду и фасовку."
        :"Проверьте источник, SKU и фасовку перед сохранением."}</p>
      {result.warnings?.map((warning,index)=><p className="import-warning" key={index}>{warning}</p>)}
      {fields.filter(([key])=>!product[key]?.trim()&&Boolean(result.fields[key])).map(([key,label])=>
        <label className="editor-field wide" key={key} style={{marginBottom:12}}>
          <span><input type="checkbox" checked={selected.includes(key)}
            onChange={event=>setSelected(previous=>event.target.checked?[...previous,key]:previous.filter(item=>item!==key))}/>
            {" "}{label}</span>
          <textarea value={draft[key]} rows={key==="description"?5:3}
            onChange={event=>setDraft(previous=>previous?{...previous,[key]:event.target.value}:previous)}/>
        </label>)}
      {!product.images?.length&&result.images.length>0&&<div>
        <h3>Фотографии</h3><p className="subtle">Выберите фото только после проверки, что оно соответствует SKU и объёму.</p>
        <div className="enrichment-images">
          <label><input type="radio" name="shared-photo" checked={!image} onChange={()=>setImage("")}/>Без фото</label>
          {result.images.map(url=><label key={url}>
            <input type="radio" name="shared-photo" checked={image===url} onChange={()=>setImage(url)}/>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={product.title+" — кандидат"} loading="lazy"/>
            <a href={url} target="_blank" rel="noreferrer">Оригинал</a>
          </label>)}
        </div>
      </div>}
      <button className="button primary" type="button" disabled={busy||!canWrite}
        onClick={()=>void stage()}>{busy?"Сохранение…":"Сохранить предложение на проверку"}</button>
    </div>}
  </section>;
}
