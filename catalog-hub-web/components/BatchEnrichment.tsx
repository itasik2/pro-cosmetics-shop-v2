"use client";

import { useState } from "react";
import Link from "next/link";
import type { HubProduct } from "@/lib/hub";

type Result = { title:string; state:string; id?:string };
type Search = { confidence:number; sourceType:string; fields:Record<string,string>; images:string[] };
const fields = ["shortDescription","description","application","ingredients"] as const;

export function BatchEnrichment({products}:{products:HubProduct[]}) {
  const [running,setRunning]=useState(false);
  const [results,setResults]=useState<Result[]>([]);
  const candidates=products.filter(product=>!product.categoryKey||fields.some(key=>!product[key]?.trim())||!product.images?.length).slice(0,5);
  async function run(){
    setRunning(true);setResults([]);
    for(const product of candidates){
      try{
        const response=await fetch("/api/ai/shared-preview",{method:"POST",headers:{"content-type":"application/json"},
          body:JSON.stringify({productId:product.id,allowExternalSearch:false})});
        const found=await response.json().catch(()=>null) as Search & {error?:string};
        if(!response.ok)throw new Error(found?.error||"search_failed");
        if(found.confidence<90||found.sourceType!=="official_unverified"){
          setResults(previous=>[...previous,{title:product.title,state:"Источник или совпадение требуют ручной проверки"}]);
          continue;
        }
        const proposed:Record<string,unknown>={};
        for(const key of fields)if(!product[key]?.trim()&&found.fields?.[key]?.trim())
          proposed[key]=found.fields[key].trim();
        if(!product.images?.length&&found.images?.[0])proposed.images=[found.images[0]];
        if(!product.categoryKey){
          const response=await fetch("/api/categories/suggest?productId="+encodeURIComponent(product.id));
          if(response.ok){
            const data=await response.json().catch(()=>null) as {suggestions?:Array<{key:string;score:number}>}|null;
            const suggestions=data?.suggestions||[];
            if(suggestions.length===1&&suggestions[0].score>=5)proposed.categoryKey=suggestions[0].key;
          }
        }
        if(!Object.keys(proposed).length){
          setResults(previous=>[...previous,{title:product.title,state:"Подходящих данных не найдено"}]);continue;
        }
        const staged=await fetch("/api/catalog/changes",{method:"POST",headers:{"content-type":"application/json"},
          body:JSON.stringify({productId:product.id,proposed})});
        const change=await staged.json().catch(()=>null);
        if(!staged.ok)throw new Error(change?.error||"changeset_failed");
        setResults(previous=>[...previous,{title:product.title,state:"Предложение создано",id:String(change.id)}]);
      }catch(error){setResults(previous=>[...previous,{title:product.title,
        state:error instanceof Error?error.message:"Ошибка поиска"}]);}
    }
    setRunning(false);
  }
  return <div className="panel" style={{marginBottom:12}}>
    <h2>Заполнить несколько карточек</h2>
    <p className="subtle">До пяти неполных товаров с текущей страницы. Поиск идёт на сайте производителя по SKU и названию.
      При совпадении от 90% создаются предложения с описанием и первым фото. Проверьте их перед применением.</p>
    <button type="button" className="button" disabled={running||!candidates.length} onClick={()=>void run()}>
      {running?`Поиск… ${results.length}/${candidates.length}`:`Подготовить предложения (${candidates.length})`}
    </button>
    {results.map((item,index)=><p className="subtle" key={index}>{item.title}: {item.state}
      {item.id&&<> · <Link href={"/changes/"+encodeURIComponent(item.id)}>Проверить →</Link></>}</p>)}
  </div>;
}
