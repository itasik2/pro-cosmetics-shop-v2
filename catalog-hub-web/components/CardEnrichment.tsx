"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { HubProduct } from "@/lib/hub";

export type CardJob = {
  id: string; status: string; error: string | null;
  product: { id: string };
};
export type CardProposal = {
  id: string; status: string; sourceUrl: string; confidence: number;
  shortDescription: string | null; description: string | null;
  application: string | null; ingredients: string | null; images: string[];
  warnings: string[];
  facts?: { extracted?: { brand?: string } } | null;
  product: { id: string };
};

const labels = {
  brand: "Бренд", shortDescription: "Краткое описание", description: "Описание",
  application: "Применение", ingredients: "Состав", images: "Фотографии",
} as const;

async function enrichmentAction(body: Record<string, unknown>): Promise<{id?:string}> {
  const response = await fetch("/api/ai/enrichment", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(result?.error || "Не удалось получить данные"));
  return result || {};
}

export function CardEnrichment({ product, jobs, proposals, canWrite }: {
  product: HubProduct; jobs: CardJob[]; proposals: CardProposal[]; canWrite: boolean;
}) {
  const router = useRouter();
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [changeId, setChangeId] = useState("");
  const [selectedImages, setSelectedImages] = useState<Record<string,string>>({});
  const [variants, setVariants] = useState<Record<string,Array<{id:string;url:string;preset:string}>>>({});
  const [selectedVariant, setSelectedVariant] = useState<Record<string,string>>({});
  const missing = (Object.keys(labels) as Array<keyof typeof labels>)
    .filter(key => key === "images" ? !product.images?.length : !product[key]?.trim());
  const pending = proposals.filter(item => item.status === "PENDING");

  async function search() {
    setBusy(true); setError(""); setChangeId("");
    try {
      const job = await enrichmentAction({ action: "create", sku: product.sku, sourceUrl });
      if (!job.id) throw new Error("Задача поиска не создана");
      await enrichmentAction({ action: "run", id: job.id });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Поиск не удался");
      router.refresh();
    } finally { setBusy(false); }
  }

  async function run(id: string) {
    setBusy(true); setError("");
    try {
      await enrichmentAction({ action: "run", id });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Поиск не удался");
      router.refresh();
    } finally { setBusy(false); }
  }

  async function processPhoto(id: string) {
    const sourceUrl = selectedImages[id];
    if (!sourceUrl) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/catalog/media", {
        method: "POST", headers: {"content-type":"application/json"},
        body: JSON.stringify({productId:product.id,sourceUrl}),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(result?.error || "Не удалось подготовить фото"));
      const prepared = result?.media?.variants;
      if (!Array.isArray(prepared) || !prepared.length) throw new Error("Варианты изображения не созданы");
      setVariants(previous => ({...previous,[id]:prepared}));
      setSelectedVariant(previous => ({...previous,[id]:prepared[0].id}));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Обработка фото не удалась");
    } finally { setBusy(false); }
  }

  async function stage(id: string) {
    setBusy(true); setError(""); setChangeId("");
    try {
      const response = await enrichmentAction({
        action: "stage", id,
        selectedImageUrl: selectedVariant[id] ? undefined : selectedImages[id] || undefined,
        selectedMediaVariantId: selectedVariant[id] || undefined,
        replaceFilledFields: false,
      });
      if (!response.id) throw new Error("Черновик изменений не создан");
      setChangeId(response.id);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить предложение");
    } finally { setBusy(false); }
  }

  return <section className="panel">
    <h2>Заполнить пустые поля и подобрать фото</h2>
    <p className="subtle">Не заполнено: {missing.map(key => labels[key]).join(", ") || "Основные поля заполнены"}.
      Поиск использует настроенные источники производителя или указанную страницу товара.
      Предложения проверяются перед записью; цены и остатки не меняются.</p>
    <div className="actions" style={{alignItems:"end"}}>
      <label className="editor-field" style={{minWidth:260,flex:1}}>
        <span>Ссылка на товар у производителя (необязательно)</span>
        <input className="input" type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)}
          placeholder="https://manufacturer.example/product" />
      </label>
      <button className="button primary" type="button" disabled={!canWrite || busy || missing.length === 0}
        onClick={() => void search()}>{busy ? "Поиск…" : "Найти и предложить"}</button>
      <Link className="button" href="/ai">Настроить источники</Link>
    </div>
    {!canWrite && <p className="subtle">Локальный режим чтения: поиск и запись отключены.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {changeId && <p role="status">Черновик создан. <Link href={"/changes/" + encodeURIComponent(changeId)}>
      Проверить предложенные изменения →</Link></p>}
    {jobs.filter(job => job.status === "PENDING" || job.status === "FAILED")
      .map(job => <div className="list-row" key={job.id}>
        <span>Поиск: {job.status === "FAILED" ? "ошибка" : "ожидает запуска"}
          {job.error && <span className="error"> · {job.error}</span>}</span>
        <button type="button" className="button" disabled={!canWrite || busy}
          onClick={() => void run(job.id)}>Повторить поиск</button>
      </div>)}
    {pending.map(proposal => <Proposal key={proposal.id} proposal={proposal}
      product={product} selectedImage={selectedImages[proposal.id] || ""}
      setImage={image => {
        setSelectedImages(previous => ({...previous,[proposal.id]:image}));
        setVariants(previous => ({...previous,[proposal.id]:[]}));
        setSelectedVariant(previous => ({...previous,[proposal.id]:""}));
      }}
      variants={variants[proposal.id] || []}
      selectedVariant={selectedVariant[proposal.id] || ""}
      selectVariant={value => setSelectedVariant(previous => ({...previous,[proposal.id]:value}))}
      disabled={!canWrite || busy} onProcess={() => void processPhoto(proposal.id)}
      onStage={() => void stage(proposal.id)} />)}
    {!pending.length && <p className="subtle">Предложений для проверки пока нет.</p>}
  </section>;
}

function Proposal({ proposal, product, selectedImage, setImage, variants, selectedVariant,
  selectVariant, disabled, onProcess, onStage }: {
  proposal: CardProposal; product: HubProduct; selectedImage: string;
  setImage: (url: string) => void; variants: Array<{id:string;url:string;preset:string}>;
  selectedVariant: string; selectVariant: (id:string) => void;
  disabled: boolean; onProcess: () => void; onStage: () => void;
}) {
  const fields = (["shortDescription", "description", "application", "ingredients"] as const)
    .filter(key => proposal[key] && !product[key]?.trim());
  const suggestedBrand = !product.brand?.trim() ? proposal.facts?.extracted?.brand : undefined;
  return <details className="panel" style={{marginTop:14}}>
    <summary>Предложение · {proposal.confidence}% совпадения · {proposal.sourceUrl}</summary>
    <p>Источник: <a href={proposal.sourceUrl} target="_blank" rel="noreferrer">{proposal.sourceUrl}</a></p>
    {proposal.warnings?.map((warning,index) =>
      <p className="import-warning" key={index}>{warning}</p>)}
    {suggestedBrand && <div className="review-diff"><div><strong>Бренд сейчас</strong><pre>Не заполнено</pre></div>
      <div><strong>Предлагается</strong><pre>{suggestedBrand}</pre></div></div>}
    {fields.map(key => <div key={key} className="review-diff">
      <div><strong>{labels[key]} сейчас</strong><pre>{product[key] || "Не заполнено"}</pre></div>
      <div><strong>Предлагается</strong><pre>{proposal[key]}</pre></div>
    </div>)}
    <h3>Фотографии</h3>
    {product.images.length > 0 && <p className="subtle">
      У товара уже есть фото. Автозаполнение не заменит их; при необходимости отредактируйте ссылки выше.
    </p>}
    <label className="review-check"><input type="radio" name={"photo-" + proposal.id}
      checked={!selectedImage} onChange={() => setImage("")} />Не добавлять фото</label>
    {!product.images.length && <div className="enrichment-images">
      {proposal.images?.map(url => <label key={url}>
        <input type="radio" name={"photo-" + proposal.id} checked={selectedImage === url}
          onChange={() => setImage(url)} />
        <img src={url} alt={product.title + " — предложенное фото"} loading="lazy" />
        <a href={url} target="_blank" rel="noreferrer">Оригинал</a>
      </label>)}
    </div>}
    {!product.images.length && selectedImage && <div className="actions" style={{marginTop:12}}>
      <button type="button" className="button" disabled={disabled} onClick={onProcess}>
        Подготовить фото для сайта и маркетплейса</button>
      <span className="subtle">Оригинал сохранится отдельно; обработка использует профили Catalog Hub.</span>
    </div>}
    {variants.length > 0 && <div className="enrichment-images" style={{marginTop:12}}>
      {variants.map(variant => <label key={variant.id}>
        <input type="radio" name={"prepared-" + proposal.id} checked={selectedVariant === variant.id}
          onChange={() => selectVariant(variant.id)} />
        <img src={variant.url} alt={product.title + " — обработанное фото"} loading="lazy" />
        <span>{variant.preset}</span>
      </label>)}
      <label><input type="radio" name={"prepared-" + proposal.id} checked={!selectedVariant}
        onChange={() => selectVariant("")} />Использовать оригинал</label>
    </div>}
    <button type="button" className="button"
      disabled={disabled || (!fields.length && !selectedImage && !suggestedBrand)}
      onClick={onStage}>Сохранить предложение для проверки</button>
  </details>;
}
