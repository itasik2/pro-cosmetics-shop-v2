"use client";
import { useState } from "react";
import { enrichmentErrorMessage } from "@/lib/enrichment-messages";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ENRICHMENT_LABELS, missingEnrichmentFields } from "@/lib/universal-catalog";

type Product = { id: string; sku: string; title: string; brand: string | null };
export type EnrichmentJob = { id: string; status: string; error: string | null; attempt: number; product: Product };
export type EnrichmentProposal = {
  id: string; status: string; sourceUrl: string; confidence: number;
  shortDescription: string | null; description: string | null; ingredients: string | null;
  application: string | null; images: string[]; warnings: string[];
  product: Product & { categoryKey: string | null; shortDescription: string | null; description: string | null;
    ingredients: string | null; application: string | null; images: string[] };
};
export type SourcePolicy = { id: string; domain: string; sourceType: string; supplier: { code: string; name: string } };
const statusLabels: Record<string, string> = { PENDING: "Ожидает запуска", RUNNING: "Поиск выполняется", REVIEW: "На проверке", FAILED: "Ошибка", APPLIED: "Применено", REJECTED: "Отклонено" };

export function EnrichmentConsole({ jobs, proposals, policies, canWrite, initialSku }: {
  jobs: EnrichmentJob[]; proposals: EnrichmentProposal[]; policies: SourcePolicy[];
  canWrite: boolean; initialSku: string;
}) {
  const router = useRouter();
  const [sku, setSku] = useState(initialSku);
  const [supplierCode, setSupplierCode] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [allowExternalSearch, setAllowExternalSearch] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [stagedChangeId, setStagedChangeId] = useState("");
  const [sourceCode, setSourceCode] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [domainUrl, setDomainUrl] = useState("");
  const [sourceType, setSourceType] = useState("OFFICIAL_SITE");
  async function act(key: string, body: Record<string, unknown>) {
    setBusy(key); setError(""); setMessage(""); setStagedChangeId("");
    try {
      const response = await fetch("/api/ai/enrichment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "enrichment_failed");
      if (body.action === "stage") {
        if (typeof data.id !== "string" || !/^c[a-z0-9]{24}$/.test(data.id)) throw new Error("invalid_changeset_id");
        setStagedChangeId(data.id);
      }
      setMessage(body.action === "create" ? "Задача добавлена. Нажмите «Запустить поиск» в очереди." : body.action === "stage"
        ? "Черновик создан. Проверьте и согласуйте изменения." : body.action === "source" ? "Источник сохранён." : "Поиск завершён. Проверьте предложение ниже.");
      router.refresh();
    } catch (e) { setError(enrichmentErrorMessage(e)); }
    finally { setBusy(""); }
  }
  const suppliers = [...new Map(policies.map(p => [p.supplier.code, p.supplier])).values()];
  return <>
    {!canWrite && <p className="error">Режим только чтения: запуск поиска и сохранение отключены.</p>}
    <section className="panel">
      <h2>Дополнить карточку</h2>
      <p className="subtle">Сначала сохраните товар из импорта. Выберите источники поставщика для поиска точного товара и объёма. Для сайта дистрибьютора укажите ссылку на товар.</p>
      <form onSubmit={e => { e.preventDefault(); void act("create", { action: "create", sku, supplierCode, sourceUrl, allowExternalSearch }); }}>
        <div className="editor-grid">
          <label className="editor-field"><span>Внутренний SKU</span><input className="input" required maxLength={100} value={sku} onChange={e => setSku(e.target.value)} /></label>
          <label className="editor-field"><span>Источники поставщика</span><select className="input" value={supplierCode} onChange={e => setSupplierCode(e.target.value)}>
            <option value="">Источники, привязанные к товару</option>
            {suppliers.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select></label>
          <label className="editor-field wide"><span>Ссылка на товар (необязательно)</span><input className="input" type="url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://…" /></label>
        </div>
        <label className="review-check"><input type="checkbox" checked={allowExternalSearch} onChange={e => setAllowExternalSearch(e.target.checked)} />Если производитель не найден, искать у других продавцов (потребуется ИИ и ручная проверка)</label>
        <button className="button primary" style={{ marginTop: 12 }} disabled={!canWrite || Boolean(busy)}>Добавить в очередь</button>
      </form>
    </section>
    <details className="panel" style={{ marginTop: 14 }}>
      <summary>Настроить источники поиска</summary>
      <p className="subtle">Укажите сайт производителя или дистрибьютора. Система будет искать только на разрешённых доменах.</p>
      <div className="list">{policies.map(p => <div className="list-row" key={p.id}><span>{p.supplier.name} · {p.domain}</span><span className="badge">{p.sourceType === "OFFICIAL_SITE" ? "Производитель" : "Дистрибьютор"}</span></div>)}</div>
      <form onSubmit={e => { e.preventDefault(); void act("source", { action: "source", supplierCode: sourceCode, name: sourceName, sourceUrl: domainUrl, sourceType }); }}>
        <div className="editor-grid">
          <label className="editor-field"><span>Код поставщика</span><input className="input" required maxLength={80} value={sourceCode} onChange={e => setSourceCode(e.target.value)} placeholder="JEUDERM" /></label>
          <label className="editor-field"><span>Название поставщика</span><input className="input" required maxLength={128} value={sourceName} onChange={e => setSourceName(e.target.value)} /></label>
          <label className="editor-field"><span>Сайт</span><input className="input" required type="url" value={domainUrl} onChange={e => setDomainUrl(e.target.value)} /></label>
          <label className="editor-field"><span>Тип источника</span><select className="input" value={sourceType} onChange={e => setSourceType(e.target.value)}><option value="OFFICIAL_SITE">Официальный сайт производителя</option><option value="DISTRIBUTOR">Дистрибьютор</option></select></label>
        </div>
        <button className="button" style={{ marginTop: 12 }} disabled={!canWrite || Boolean(busy)}>Сохранить источник</button>
      </form>
    </details>
    {error && <div className="error" role="alert" style={{ marginTop: 14 }}>{error}</div>}
    {message && <p role="status">{message} <Link href={stagedChangeId ? "/changes/" + stagedChangeId : "/changes"}>{stagedChangeId ? "Открыть черновик →" : "Изменения →"}</Link></p>}
    <section className="panel" style={{ marginTop: 14 }}>
      <h2>Очередь обогащения</h2>
      <button className="button" type="button" disabled={Boolean(busy)} onClick={() => router.refresh()}>Обновить статусы</button>
      {!jobs.length && <p className="empty">Задач пока нет.</p>}
      <div className="list">{jobs.map(job => <div className="list-row" key={job.id}>
        <div><strong>{job.product.title}</strong><div className="subtle">{job.product.sku} · {statusLabels[job.status] || job.status} · Попыток: {job.attempt}</div>{job.error && <div className="error">{enrichmentErrorMessage(job.error)}</div>}</div>
        {["PENDING", "FAILED"].includes(job.status) && <button className="button" disabled={!canWrite || Boolean(busy)} onClick={() => void act(job.id, { action: "run", id: job.id })}>{busy === job.id ? "Поиск…" : job.status === "FAILED" ? "Повторить поиск" : "Запустить поиск"}</button>}
      </div>)}</div>
    </section>
    <section style={{ marginTop: 14 }}>
      <h2>Предложения на проверку</h2>
      <p className="subtle">Предложения не изменяют товар. По умолчанию заполняются только пустые поля; цены и остатки не затрагиваются. Категория проверяется отдельно в редакторе товара.</p>
      {!proposals.length && <p className="empty">Предложений пока нет.</p>}
      {proposals.map(p => <ProposalReview key={p.id} proposal={p} disabled={!canWrite || Boolean(busy)} onStage={(image, replace) => void act(p.id, { action: "stage", id: p.id, selectedImageUrl: image, replaceFilledFields: replace })} />)}
    </section>
  </>;
}

function ProposalReview({ proposal: p, disabled, onStage }: { proposal: EnrichmentProposal; disabled: boolean; onStage: (image: string, replace: boolean) => void }) {
  const [image, setImage] = useState("");
  const [replace, setReplace] = useState(false);
  const missing = missingEnrichmentFields(p.product);
  const fields = ["shortDescription", "description", "ingredients", "application"] as const;
  const labels = { shortDescription: "Краткое описание", description: "Описание", ingredients: "Состав", application: "Применение" };
  return <details className="panel" style={{ marginTop: 12 }}>
    <summary><strong>{p.product.title}</strong> · {p.confidence}% совпадения · {statusLabels[p.status] || p.status}</summary>
    <p className="subtle">{p.product.sku} · Не хватает: {missing.map(f => ENRICHMENT_LABELS[f]).join(", ") || "Все основные поля заполнены"}</p>
    <p>Источник: <a href={p.sourceUrl} target="_blank" rel="noreferrer">{p.sourceUrl}</a></p>
    {Array.isArray(p.warnings) && p.warnings.map((w, i) => <p className="import-warning" key={i}>{w}</p>)}
    {fields.filter(field => p[field]).map(field => <div key={field}>
      <h3>{labels[field]}</h3><div className="review-diff"><div><strong>Сейчас</strong><pre>{p.product[field] || "Не заполнено"}</pre></div><div><strong>Предложение</strong><pre>{p[field]}</pre></div></div>
    </div>)}
    <h3>Фотографии из источника</h3>
    <p className="subtle">Проверьте упаковку и объём. На этом этапе выбирается оригинал; обработка изображения выполняется отдельно.</p>
    <label className="review-check"><input type="radio" name={"image-" + p.id} checked={!image} onChange={() => setImage("")} />Не добавлять фотографию</label>
    <div className="enrichment-images">{Array.isArray(p.images) && p.images.map(url => <label key={url}>
      <input type="radio" name={"image-" + p.id} checked={image === url} onChange={() => setImage(url)} />
      <img src={url} alt={p.product.title + " — фотография из источника"} loading="lazy" />
      <a href={url} target="_blank" rel="noreferrer">Открыть оригинал</a>
    </label>)}</div>
    <label className="review-check" style={{ marginTop: 14 }}><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />Разрешить замену заполненных полей и текущих фотографий в черновике</label>
    <button className="button" disabled={disabled || p.status !== "PENDING"} onClick={() => onStage(image, replace)}>Создать черновик изменений</button>
  </details>;
}
