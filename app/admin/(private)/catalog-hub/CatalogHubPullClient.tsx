"use client";

import { useState } from "react";

type Row={sku:string;title:string;hubUpdatedAt:string;localId:string|null;localUpdatedAt:string|null;
  status:"MATCH"|"REVIEW_MATCH";before:Record<string,string|number|null>|null;
  changes:Record<string,string|number>;priceChange:number|null;purchaseChange:number|null};
const labels:Record<string,string>={shortDescription:"Краткое описание",description:"Описание и применение",
  image:"Главное фото",category:"Категория",price:"Розничная цена",sourcePrice:"Закупочная цена"};

export default function CatalogHubPullClient(){
  const [rows,setRows]=useState<Row[]>([]);
  const [busy,setBusy]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [updatePrices,setUpdatePrices]=useState(false);
  async function load(){
    setBusy(true);setError("");setMessage("");
    try{const response=await fetch("/api/admin/catalog-hub/pull",{cache:"no-store"});
      const body=await response.json();if(!response.ok)throw new Error(body.error||"preview_failed");
      setRows(body.items||[]);setLoaded(true);
    }catch(e){setError(e instanceof Error?e.message:"preview_failed");}
    finally{setBusy(false);}
  }
  async function apply(row:Row){
    const fields={...row.changes,...(updatePrices&&row.priceChange!==null?{price:row.priceChange}:{}),
      ...(updatePrices&&row.purchaseChange!==null?{sourcePrice:row.purchaseChange}:{})};
    if(!Object.keys(fields).length)return;
    if(!window.confirm(`Применить к ${row.sku}: ${Object.keys(fields).map(key=>labels[key]||key).join(", ")}?`))return;
    setBusy(true);setError("");setMessage("");
    try{const response=await fetch("/api/admin/catalog-hub/pull",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({sku:row.sku,hubUpdatedAt:row.hubUpdatedAt,localUpdatedAt:row.localUpdatedAt,
        updatePrices,confirmed:true})});
      const body=await response.json();if(!response.ok)throw new Error(body.error||"apply_failed");
      setMessage(`${row.sku}: обновлено ${body.fields.map((key:string)=>labels[key]||key).join(", ")}.`);
      await load();
    }catch(e){setError(e instanceof Error?e.message:"apply_failed");}
    finally{setBusy(false);}
  }
  const candidates=rows.filter(row=>row.status==="MATCH"&&
    (Object.keys(row.changes).length||updatePrices&&(row.priceChange!==null||row.purchaseChange!==null)));
  return <section className="rounded-xl border bg-white p-4 space-y-3">
    <h2 className="font-semibold">Применить готовые карточки из Catalog Hub</h2>
    <p className="text-sm text-gray-500">Точное совпадение SKU и бренда. Заполняются только пустые поля.
      Новые товары и неоднозначные совпадения остаются на ручную проверку. Остатки не меняются.</p>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
        disabled={busy} onClick={()=>void load()}>{busy?"Обработка…":"Проверить расхождения"}</button>
      <label className="text-sm"><input type="checkbox" checked={updatePrices}
        onChange={e=>setUpdatePrices(e.target.checked)}/> Включить цены (после отдельного подтверждения)</label>
    </div>
    {loaded&&<p className="text-sm text-gray-500">Предложений: {candidates.length} · требуется сопоставление: {rows.filter(row=>row.status==="REVIEW_MATCH").length}</p>}
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    {message&&<p role="status" className="text-sm text-green-700">{message}</p>}
    {loaded&&<div className="max-h-96 overflow-auto border rounded-lg"><table className="w-full text-left text-sm">
      <thead><tr><th className="p-2">Товар</th><th className="p-2">Изменения</th><th className="p-2">Действие</th></tr></thead>
      <tbody>{rows.filter(row=>row.status==="REVIEW_MATCH"||candidates.includes(row)).map(row=><tr className="border-t" key={row.sku}>
        <td className="p-2">{row.title}<div className="text-gray-500">{row.sku}</div></td>
        <td className="p-2">{row.status==="REVIEW_MATCH"?"Совпадение SKU и бренда не подтверждено":
          <details><summary className="cursor-pointer">Показать изменения</summary>
            {Object.entries({...row.changes,...(updatePrices&&row.priceChange!==null?{price:row.priceChange}:{}),
              ...(updatePrices&&row.purchaseChange!==null?{sourcePrice:row.purchaseChange}:{})})
              .map(([key,value])=><div className="my-2" key={key}><strong>{labels[key]||key}</strong>
                <div className="text-gray-500 break-all">Было: {String(row.before?.[key]??"—").slice(0,400)}</div>
                <div className="break-all">Будет: {String(value).slice(0,400)}</div>
              </div>)}
          </details>}</td>
        <td className="p-2">{row.status==="MATCH"&&<button type="button" className="rounded-lg border px-3 py-1 disabled:opacity-50"
          disabled={busy} onClick={()=>void apply(row)}>Применить</button>}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
