"use client";

import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { HubProduct } from "@/lib/hub";
import { SharedProductSearch } from "@/components/SharedProductSearch";
import { separateProductSections } from "@/lib/product-sections";
import { chooseAutomaticCategory, type CategorySuggestion } from "@/lib/category-choice";

type Values = {
  title: string;
  barcode: string;
  brand: string;
  categoryKey: string;
  shortDescription: string;
  description: string;
  application: string;
  ingredients: string;
  purchasePrice: string;
  price: string;
  attributes: string;
  images: string;
};

const textInputs = [
  ["title", "Название *"],
  ["brand", "Бренд"],
  ["barcode", "Штрихкод"],
  ["categoryKey", "Категория"],
  ["shortDescription", "Краткое описание (до 280 символов)"],
  ["description", "Полное описание"],
  ["application", "Применение"],
  ["ingredients", "Состав"],
] as const;


function formatAttributes(value: unknown): string {
  // Imported legacy cards store a serialized JSON object inside a jsonb string.
  // Unwrap a bounded number of JSON string layers for display without rewriting data.
  let decoded = value;
  for (let layer = 0; layer < 2 && typeof decoded === "string"; layer++) {
    try {
      decoded = JSON.parse(decoded);
    } catch {
      return String(decoded);
    }
  }
  if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
    return JSON.stringify(decoded, null, 2);
  }
  return typeof decoded === "string" ? decoded : "{}";
}

type Category = {key:string;name:string;isActive:boolean;productCount:number};
export function ProductEditor({ product, categories, searchEnabled, canWrite }: {
  product: HubProduct; categories: Category[]; searchEnabled: boolean; canWrite: boolean;
}) {
  const router=useRouter();
  const [form, setForm] = useState<Values>({
    title: product.title || "",
    barcode: product.barcode || "",
    brand: product.brand || "",
    categoryKey: product.categoryKey === "Без категории" ? "" : product.categoryKey || "",
    shortDescription: product.shortDescription || "",
    description: product.description || "",
    application: product.application || "",
    ingredients: product.ingredients || "",
    purchasePrice: product.purchasePrice == null ? "" : String(product.purchasePrice),
    price: product.price == null ? "" : String(product.price),
    attributes: formatAttributes(product.attributes),
    images: (product.images || []).join("\n"),
  });
  const [dirty, setDirty] = useState<Set<keyof Values>>(() => new Set());
  const currentCategory=useRef(product.categoryKey === "Без категории" ? "" : product.categoryKey || "");
  const categoryEditedByUser=useRef(false);
  const formEdited=useRef(false);
  const [categoryStatus,setCategoryStatus]=useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success,setSuccess]=useState("");
  const [version,setVersion]=useState(product.updatedAt);
  const separated = separateProductSections(form);

  useEffect(() => {
    if (!canWrite || currentCategory.current || !categories.some(category => category.isActive)) return;
    const controller = new AbortController();
    setCategoryStatus("Определяем категорию по карточке…");
    fetch("/api/categories/suggest?productId=" + encodeURIComponent(product.id), {
      signal: controller.signal, cache: "no-store",
    }).then(async response => {
      if (!response.ok) throw new Error("category_suggestion_failed");
      return response.json() as Promise<{suggestions?:CategorySuggestion[]}>;
    }).then(data => {
      if (controller.signal.aborted || formEdited.current || currentCategory.current || categoryEditedByUser.current) return;
      const allowed = new Set(categories.filter(category => category.isActive).map(category => category.key));
      const category = chooseAutomaticCategory((data.suggestions || []).filter(item => allowed.has(item.key)));
      if (!category) {
        setCategoryStatus("Категория не определена однозначно. Выберите её вручную или запустите поиск товара.");
        return;
      }
      currentCategory.current = category;
      setForm(previous => ({...previous, categoryKey: category}));
      setDirty(previous => new Set(previous).add("categoryKey"));
      setCategoryStatus("Подставлено автоматически: " + category + ". Проверьте перед сохранением.");
    }).catch(() => {
      if (!controller.signal.aborted && !formEdited.current && !currentCategory.current)
        setCategoryStatus("Не удалось определить категорию. Выберите её вручную или запустите поиск товара.");
    });
    return () => controller.abort();
  }, [product.id, canWrite, categories]);

  function update(key: keyof Values, value: string) {
    formEdited.current=true;
    setCategoryStatus("");
    if(key==="categoryKey")currentCategory.current=value;
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty((prev) => new Set(prev).add(key));
    setError("");
    setSuccess("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    // Only submit fields the operator actually edited. Imported legacy data in
    // unrelated fields must never be silently normalized or erased by price edits.
    if (dirty.size === 0) {
      setError("Нет изменений для сохранения.");
      return;
    }
    const proposed: Record<string, unknown> = {};
    for (const [key] of textInputs) {
      if (!dirty.has(key)) continue;
      const value = form[key].trim();
      if (key === "title" && !value) {
        setError("Укажите название товара.");
        return;
      }
      proposed[key] = value || null;
    }
    for (const key of ["purchasePrice", "price"] as const) {
      if (!dirty.has(key)) continue;
      const raw = form[key].trim();
      const value = raw === "" ? null : Number(raw);
      if (value !== null && (!Number.isSafeInteger(value) ||
        value < (key === "price" ? 1 : 0))) {
        setError("Проверьте цену: нужны целые неотрицательные значения, розничная цена — больше нуля.");
        return;
      }
      proposed[key] = value;
    }
    if (dirty.has("attributes")) {
      try {
        let parsed: unknown = JSON.parse(form.attributes);
        for (let layer = 0; layer < 2 && typeof parsed === "string"; layer++) {
          parsed = JSON.parse(parsed);
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        proposed.attributes = parsed;
      } catch {
        setError("Характеристики должны быть JSON-объектом.");
        return;
      }
    }
    if (dirty.has("images")) {
      const images = form.images.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
      if (images.some((src) => !/^https?:\/\/[^ ]+$/i.test(src))) {
        setError("Ссылки на фотографии должны начинаться с http:// или https://.");
        return;
      }
      proposed.images = images;
    }
    const changedLabels=Object.keys(proposed).map(key=>textInputs.find(([field])=>field===key)?.[1]||
      ({purchasePrice:"Закупочная цена",price:"Розничная цена",images:"Фотографии",attributes:"Характеристики"} as Record<string,string>)[key]||key);
    if(!window.confirm(`Сохранить изменения товара ${product.sku}?\n\n${changedLabels.join(", ")}`))return;
    setBusy(true);
    try {
      const response = await fetch("/api/catalog/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: product.id, expectedUpdatedAt:version, proposed }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(data?.error || "Не удалось сохранить изменения"));
      setVersion(data.updatedAt);
      setDirty(new Set());
      setSuccess("Изменения сохранены в карточке.");
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message === "changeset_empty" ? "Изменений нет." :
        message === "product_changed_reload" ? "Карточка изменилась. Обновите страницу перед сохранением." : message);
    } finally {setBusy(false);}
  }

  return (
    <form className="panel editor-panel" onSubmit={submit}>
      <div className="editor-heading">
        <div>
          <h2>Карточка товара</h2>
          <p className="subtle">Исправьте нужные данные и сохраните карточку после подтверждения.</p>
        </div>
        <span className="badge">{product.sku}</span>
      </div>
      <div className="editor-grid">
        {textInputs.map(([key, label]) => (
          <Fragment key={key}>
          {(key==="title"||key==="shortDescription")&&<h3 className="editor-section-title">
            {key==="title"?"Основное":"Описание и применение"}</h3>}
          <label className={["description","application","ingredients","shortDescription"].includes(key) ? "editor-field wide" : "editor-field"}>
            <span>{label}</span>
            {key === "categoryKey" ? (
              <>
                <select className="input" value={form.categoryKey}
                  onChange={(event) => {categoryEditedByUser.current=true;update("categoryKey", event.target.value);}}>
                  <option value="">Без категории — требуется проверка</option>
                  {categories.filter((cat) => cat.isActive).map(cat =>
                    <option key={cat.key} value={cat.key}>{cat.name}</option>)}
                </select>
                {categoryStatus && <span className="subtle" role="status">{categoryStatus}</span>}
              </>
            ) : ["description","application","ingredients","shortDescription"].includes(key) ? (
              <textarea
                rows={key === "description" ? 6 : 3}
                maxLength={key === "shortDescription" ? 280 : undefined}
                value={form[key]}
                onChange={(event) => update(key, event.target.value)}
              />
            ) : (
              <input className="input" value={form[key]} maxLength={key === "title" ? 500 : undefined}
                onChange={(event) => update(key, event.target.value)} required={key === "title"} />
            )}
          </label>
          </Fragment>
        ))}
        {separated.changed && <div className="editor-field wide">
          <button type="button" className="button" disabled={!canWrite || busy} onClick={() => {
            if (separated.description !== form.description) update("description", separated.description);
            if (separated.application !== form.application) update("application", separated.application);
            if (separated.ingredients !== form.ingredients) update("ingredients", separated.ingredients);
          }}>Разнести применение и состав по полям</button>
          <span className="subtle">Проверьте результат и сохраните карточку. Уже заполненные поля сохранятся.</span>
        </div>}
        <h3 className="editor-section-title">Цены</h3>
        <label className="editor-field">
          <span>Закупочная цена, ₸</span>
          <input className="input" type="number" min="0" step="1" value={form.purchasePrice} onChange={(event) => update("purchasePrice", event.target.value)} />
        </label>
        <label className="editor-field">
          <span>Розничная цена, ₸</span>
          <input className="input" type="number" min="1" step="1" value={form.price} onChange={(event) => update("price", event.target.value)} />
        </label>
        <h3 className="editor-section-title">Фотографии</h3>
        <label className="editor-field wide">
          <span>Ссылки на изображения (по одной в строке)</span>
          <textarea rows={4} value={form.images} onChange={(event) => update("images", event.target.value)} />
          <span className="subtle">Первая фотография — главная. Можно добавить ссылку или выбрать фото из поиска ниже.</span>
          <div className="enrichment-images" style={{marginTop:10}}>
            {form.images.split(/\r?\n/).map(src=>src.trim()).filter(Boolean).map((src,index,urls)=><div className="product-photo" key={src+index}>
              {/^(https?:\/\/)[^ ]+$/i.test(src)&&<img src={src} alt={form.title+" — фото "+(index+1)} loading="lazy"/>}
              <span className="subtle">{index===0?"Главное фото":"Фото "+(index+1)}</span>
              {index>0&&<button type="button" className="button" onClick={()=>update("images",[src,...urls.filter((_,i)=>i!==index)].join("\n"))}>Сделать главным</button>}
              <button type="button" className="button" onClick={()=>update("images",urls.filter((_,i)=>i!==index).join("\n"))}>Убрать</button>
            </div>)}
            {!form.images.trim() && <span className="subtle">Фото пока нет</span>}
          </div>
        </label>
        <details className="editor-advanced">
          <summary>Дополнительные характеристики</summary>
          <p className="subtle">Служебные данные прайса и характеристики товара. Изменяйте JSON только при необходимости.</p>
          <label className="editor-field"><span>Характеристики (JSON)</span>
            <textarea className="editor-json" rows={5} value={form.attributes} onChange={(event) => update("attributes", event.target.value)} />
          </label>
        </details>
      </div>
      <div style={{marginTop:14}}>
        <SharedProductSearch product={product} enabled={searchEnabled} canWrite={canWrite}
          categoryKey={form.categoryKey}
          onSelect={proposal=>{
            for(const [key,value] of Object.entries(proposal)){
              if(key==="images") update("images",(value as string[]).join("\n"));
              else if(key==="categoryKey"){
                if(!categoryEditedByUser.current&&!currentCategory.current)update("categoryKey",String(value));
              }
              else update(key as keyof Values,String(value));
            }
          }}/>
      </div>
      <p className="subtle">SKU и складские остатки изменяются отдельно. Несохранённых полей: {dirty.size}.</p>
      {success&&<p className="stock-success" role="status">{success}</p>}
      {error && <div role="alert" className="error">{error}</div>}
      <div className="actions"><button type="submit" className="button primary" disabled={!canWrite||busy||dirty.size===0}>{busy ? "Сохранение…" : "Сохранить карточку"}</button></div>
    </form>
  );
}
