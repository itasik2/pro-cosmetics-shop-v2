"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Locale = "kk" | "en";
type Kind = "product" | "post";
type Status = "all" | "MISSING" | "REVIEW" | "PUBLISHED" | "STALE";
type Translation = {
  name: string; summary: string | null; body: string; status: string; sourceHash: string;
};
type Item = {
  key: string; name: string; summary: string | null; body: string; hash: string;
  brand: string | null; sku: string | null; state: Status; translation: Translation | null;
};
type Result = { items: Item[]; count: number; pages: number; page: number };

const STATES: Record<Exclude<Status, "all">, string> = {
  MISSING: "Нет перевода", REVIEW: "На проверке", PUBLISHED: "Опубликовано", STALE: "Оригинал изменён",
};
const EMPTY: Result = { items: [], count: 0, pages: 1, page: 1 };

export default function AdminTranslationsClient() {
  const [kind, setKind] = useState<Kind>("product");
  const [locale, setLocale] = useState<Locale>("kk");
  const [status, setStatus] = useState<Status>("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Result>(EMPTY);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkLimit, setBulkLimit] = useState(20);
  const [bulkProgress, setBulkProgress] = useState({ completed: 0, failed: 0 });
  const stopBulk = useRef(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    const params = new URLSearchParams({ kind, locale, status, q: search, page: String(page) });
    try {
      const res = await fetch("/api/admin/translations?" + params, { cache: "no-store", signal });
      if (!res.ok) throw new Error("Не удалось получить переводы.");
      const result = await res.json() as Result;
      if (!signal?.aborted) setData(result);
    } catch {
      if (!signal?.aborted) setMessage("Не удалось загрузить данные переводов.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [kind, locale, status, search, page]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Reset the editor when filters or language change so stale content cannot
  // accidentally be saved under a different locale.
  useEffect(() => {
    setSelected(null);
    setName("");
    setSummary("");
    setBody("");
  }, [kind, locale, status, search, page]);

  const item = data.items.find((value) => value.key === selected) || null;
  const choose = (value: Item) => {
    setSelected(value.key);
    setName(value.translation?.name || "");
    setSummary(value.translation?.summary || "");
    setBody(value.translation?.body || "");
    setMessage("");
  };

  const generate = async () => {
    if (!item || busy) return;
    if ((name.trim() || body.trim()) && !confirm("Заменить несохранённый текст черновиком ИИ?")) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/translations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: item.key, locale, sourceHash: item.hash }),
      });
      const result = await response.json();
      if (!response.ok || !result.draft) throw new Error(result.error || "Ошибка подготовки перевода.");
      setName(result.draft.name);
      setSummary(result.draft.summary || "");
      setBody(result.draft.body);
      setMessage("Черновик ИИ получен. Проверьте текст и сохраните перевод.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка подготовки перевода.");
    } finally { setBusy(false); }
  };


  // Generated text is stored as REVIEW, never published without editorial confirmation.
  const prepareMissing = async () => {
    if (bulkBusy || busy) return;
    if (!confirm(
      `Подготовить до ${bulkLimit} ИИ-черновиков для ${locale.toUpperCase()}? ` +
      "Расходуется платный API OpenAI. Публикация будет только после ручной проверки.",
    )) return;
    stopBulk.current = false;
    setBulkBusy(true);
    setBulkProgress({ completed: 0, failed: 0 });
    setMessage("");
    let completed = 0;
    let failed = 0;
    try {
      // Capture the worklist before saving drafts. Pagination changes as
      // translations move from MISSING to REVIEW, so paging while mutating
      // silently skips products.
      const pending: Item[] = [];
      let currentPage = 1;
      let totalPages = 1;
      while (!stopBulk.current && currentPage <= totalPages && pending.length < bulkLimit) {
        const params = new URLSearchParams({
          kind, locale, status: "MISSING", page: String(currentPage),
        });
        const response = await fetch("/api/admin/translations?" + params, { cache: "no-store" });
        if (!response.ok) throw new Error("Не удалось получить список переводов.");
        const result = await response.json() as Result;
        pending.push(...result.items.slice(0, bulkLimit - pending.length));
        totalPages = result.pages;
        currentPage += 1;
      }
      let nextIndex = 0;
      const worker = async () => {
        while (!stopBulk.current) {
          const current = nextIndex++;
          if (current >= pending.length) return;
          const item = pending[current];
          try {
            const draftResponse = await fetch("/api/admin/translations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: item.key, locale, sourceHash: item.hash }),
            });
            const draftData = await draftResponse.json();
            if (!draftResponse.ok || !draftData.draft)
              throw new Error(draftData.error || "translation_failed");
            const saveResponse = await fetch("/api/admin/translations", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                key: item.key, locale, sourceHash: item.hash,
                name: draftData.draft.name, summary: draftData.draft.summary || null,
                body: draftData.draft.body, status: "REVIEW",
              }),
            });
            if (!saveResponse.ok) throw new Error("draft_save_failed");
            completed += 1;
          } catch {
            // This item remains MISSING and can be retried in a later run.
            failed += 1;
          }
          setBulkProgress({ completed, failed });
        }
      };
      // Bounded concurrency avoids serial processing of 346 products while
      // keeping OpenAI request rate moderate and the browser responsive.
      await Promise.all(Array.from({ length: Math.min(3, pending.length) }, () => worker()));
      setMessage(
        `Подготовлено ИИ-черновиков: ${completed}. Ошибок: ${failed}. ` +
        "Проверьте тексты и опубликуйте проверенные версии.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Пакетная подготовка прервана.");
    } finally {
      setBulkBusy(false);
      void load();
    }
  };

  const save = async (publish: boolean) => {
    if (!item || busy) return;
    if (publish && !confirm("Текст проверен? Опубликовать этот перевод на сайте?")) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/translations", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: item.key, locale, sourceHash: item.hash, name, summary: summary.trim() || null,
          body, status: publish ? "PUBLISHED" : "REVIEW",
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось сохранить перевод.");
      setMessage(publish ? "Перевод опубликован." : "Черновик сохранён.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить перевод.");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-white p-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Массовая подготовка переводов</h2>
          <p className="mt-1 text-xs text-gray-600">
            Только отсутствующие переводы. ИИ создаёт черновики для проверки; публикация вручную.
            Оставьте вкладку открытой, пока идёт обработка.
          </p>
        </div>
        <label className="flex flex-col gap-1 text-xs">Количество
          <select className="rounded-lg border p-2" value={bulkLimit} disabled={bulkBusy}
            onChange={(event) => setBulkLimit(Number(event.target.value))}>
            <option value={20}>20</option>
            <option value={100}>100</option>
            <option value={500}>Все (до 500)</option>
          </select>
        </label>
        {bulkBusy
          ? <button type="button" className="btn-secondary" onClick={() => { stopBulk.current = true; }}>Остановить</button>
          : <button type="button" className="btn" disabled={busy} onClick={() => void prepareMissing()}>Подготовить ИИ-черновики</button>}
        {(bulkBusy || bulkProgress.completed > 0 || bulkProgress.failed > 0) && (
          <p role="status" className="w-full text-xs text-gray-600">
            Подготовлено: {bulkProgress.completed}; ошибок: {bulkProgress.failed}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-white p-4">
        <label className="flex flex-col gap-1 text-sm">Раздел
          <select className="rounded-lg border p-2" value={kind} disabled={bulkBusy} onChange={(e) => { setKind(e.target.value as Kind); setPage(1); }}>
            <option value="product">Товары</option><option value="post">Блог</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">Язык
          <select className="rounded-lg border p-2" value={locale} disabled={bulkBusy} onChange={(e) => { setLocale(e.target.value as Locale); setPage(1); }}>
            <option value="kk">Қазақша</option><option value="en">English</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">Статус
          <select className="rounded-lg border p-2" value={status} disabled={bulkBusy} onChange={(e) => { setStatus(e.target.value as Status); setPage(1); }}>
            <option value="all">Все</option>
            {Object.entries(STATES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <form className="flex flex-1 flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (!bulkBusy) { setPage(1); setSearch(q); } }}>
          <label className="min-w-[160px] flex-1 text-sm">Поиск
            <input className="mt-1 w-full rounded-lg border p-2" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название, бренд или SKU" />
          </label>
          <button type="submit" className="btn-secondary">Найти</button>
        </form>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section className="min-w-0 rounded-2xl border bg-white p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Материалы ({data.count})</h2>
            {loading && <span role="status" className="text-xs text-gray-500">Обновление…</span>}
          </div>
          <div className="max-h-[580px] space-y-1 overflow-y-auto">
            {data.items.map((value) => (
              <button key={value.key} type="button" onClick={() => choose(value)}
                className={"flex w-full flex-col rounded-lg border p-3 text-left text-sm hover:bg-gray-50 " +
                  (selected === value.key ? "border-gray-800 bg-gray-50" : "border-transparent")}>
                <span className="line-clamp-2 font-semibold">{value.name}</span>
                <span className="mt-1 text-xs text-gray-500">{STATES[value.state as Exclude<Status, "all">] || value.state}</span>
              </button>
            ))}
            {!loading && !data.items.length && <p className="p-2 text-sm text-gray-500">Материалов нет.</p>}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
            <button disabled={page <= 1} className="btn-secondary" onClick={() => setPage(page - 1)}>Назад</button>
            <span className="text-sm">{page} / {data.pages}</span>
            <button disabled={page >= data.pages} className="btn-secondary" onClick={() => setPage(page + 1)}>Далее</button>
          </div>
        </section>

        <section className="min-w-0 rounded-2xl border bg-white p-4">
          {item ? (
            <div className="space-y-4">
              <h2 className="font-semibold">Перевод: {locale === "kk" ? "Қазақша" : "English"}</h2>
              <div className="max-h-[220px] space-y-2 overflow-y-auto rounded-lg bg-gray-50 p-3 text-sm">
                <p className="font-semibold">Оригинал: {item.name}</p>
                {item.summary && <p>{item.summary}</p>}
                <p className="whitespace-pre-wrap text-xs leading-6">{item.body}</p>
              </div>
              {item.state === "STALE" && <p role="alert" className="text-sm text-amber-800">Русский текст изменился. Проверьте перевод перед публикацией.</p>}
              <div className="flex flex-wrap gap-2">
                <button disabled={busy || bulkBusy} className="btn-secondary" onClick={() => void generate()}>
                  {busy ? "Обработка…" : "Подготовить черновик ИИ"}
                </button>
              </div>
              <label className="block text-sm font-medium">Название
                <input className="mt-1 w-full rounded-lg border p-2" maxLength={240} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="block text-sm font-medium">Краткое описание / категория
                <textarea className="mt-1 w-full rounded-lg border p-2" rows={3} maxLength={1200} value={summary} onChange={(e) => setSummary(e.target.value)} />
              </label>
              <label className="block text-sm font-medium">Описание / текст статьи
                <textarea className="mt-1 w-full rounded-lg border p-2 font-mono text-sm leading-6" rows={12} maxLength={30000} value={body} onChange={(e) => setBody(e.target.value)} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" disabled={busy || bulkBusy || !name.trim() || !body.trim()} onClick={() => void save(false)}>Сохранить черновик</button>
                <button className="btn" disabled={busy || bulkBusy || !name.trim() || !body.trim()} onClick={() => void save(true)}>Опубликовать перевод</button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Выберите товар или статью слева, чтобы проверить перевод.</p>
          )}
        </section>
      </div>
      {message && <p role="status" className="rounded-xl border bg-white px-4 py-3 text-sm">{message}</p>}
    </div>
  );
}
