"use client";
import { useEffect, useState } from "react";
import { coreRequest, type CoreProduct } from "@/lib/core-client";

export function CoreProductPicker({ products, value, onChange }: { products: CoreProduct[]; value: string; onChange: (id: string) => void }) {
  const [query,setQuery] = useState("");
  const [options,setOptions] = useState(products);
  const [error,setError] = useState("");
  const [remembered,setRemembered] = useState<CoreProduct|null>(null);
  useEffect(() => {
    if (!query.trim()) { setOptions(products); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void coreRequest<CoreProduct[]>("catalog/product-options?limit=50&q=" + encodeURIComponent(query), undefined, undefined, controller.signal)
        .then(data => { setOptions(data); setError(""); })
        .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Поиск не выполнен"); });
    },300);
    return () => { clearTimeout(timer); controller.abort(); };
  },[query,products]);
  const selected = options.find(p=>p.id===value) || products.find(p => p.id === value) || (remembered?.id===value?remembered:null);
  const choices = selected && !options.some(p => p.id === selected.id) ? [selected,...options] : options;
  return <div className="core-field">
    <label>Поиск товара<input className="input" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Название или SKU" /></label>
    <label>Товар<select className="input" required value={value} onChange={e=>{setRemembered(choices.find(p=>p.id===e.target.value)||null);onChange(e.target.value);}}>
      <option value="">Выберите товар</option>{choices.map(p=><option key={p.id} value={p.id}>{p.sku} · {p.title}</option>)}
    </select></label>
    {error && <span role="alert" className="error">{error}</span>}
  </div>;
}
