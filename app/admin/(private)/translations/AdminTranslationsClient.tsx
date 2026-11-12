"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Locale = "kk" | "en";
type Kind = "product" | "post";
type Status = "all" | "MISSING" | "REVIEW" | "PUBLISHED" | "STALE";
type LanguageStatus = "MISSING" | "REVIEW" | "PUBLISHED" | "STALE";
type Translation = {
  name: string; summary: string | null; body: string; status: string; sourceHash: string;
};
type Item = {
  key: string; name: string; summary: string | null; body: string; hash: string;
  brand: string | null; sku: string | null; state: Status; translation: Translation | null;
  languages: Record<Locale, LanguageStatus>;
};
type Result = { items: Item[]; count: number; pages: number; page: number };

const STATES: Record<Exclude<Status, "all">, string> = {
  MISSING: "Нет перевода", REVIEW: "На проверке", PUBLISHED: "Опубликовано", STALE: "Оригинал изменён",
};
const EMPTY: Result = { items: [], count: 0, pages: 1, page: 1 };

const LOCALE_BADGES: ReadonlyArray<{ locale: Locale; label: string }> = [
  { locale: "kk", label: "ҚАЗ" },
  { locale: "en", label: "EN" },
];
const LANGUAGE_BADGE_STYLE: Record<LanguageStatus, string> = {
  PUBLISHED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  REVIEW: "border-amber-200 bg-amber-50 text-amber-800",
  STALE: "border-orange-200 bg-orange-50 text-orange-800",
  MISSING: "border-gray-200 bg-gray-50 text-gray-400",
};
const LANGUAGE_BADGE_MARK: Record<LanguageStatus, string> = {
  PUBLISHED: "✓", REVIEW: "•", STALE: "!", MISSING: "−",
};
const LANGUAGE_BADGE_LABEL: Record<LanguageStatus, string> = {
  PUBLISHED: "опубликован", REVIEW: "черновик, на проверке",
  STALE: "устарел, нужен перевод", MISSING: "перевода нет",
};

function LanguageBadges({ languages }: { languages: Record<Locale, LanguageStatus> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {LOCALE_BADGES.map(({ locale, label }) => {
        const state = languages[locale];
        const description = `${label}: ${LANGUAGE_BADGE_LABEL[state]}`;
        return (
          <span key={locale} title={description} aria-label={description}
            className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${LANGUAGE_BADGE_STYLE[state]}`}>
            {label} {LANGUAGE_BADGE_MARK[state]}
          </span>
        );
      })}
    </span>
  );
}

type ApiError = {
  error?: string;
  code?: string;
  providerStatus?: number;
  parameter?: string;
};
const ERROR_LABELS: Record<string, string> = {
  invalid_api_key: "Ключ OpenAI недействителен. Проверьте OPENAI_API_KEY в настройках Vercel.",
  insufficient_quota: "У OpenAI закончились средства или превышен лимит расходов. Проверьте биллинг API.",
  billing_hard_limit_reached: "Превышен лимит расходов OpenAI API.",
  rate_limit_exceeded: "Достигнут лимит запросов OpenAI. Уменьшите нагрузку и повторите позже.",
  model_not_found: "Выбранная модель OpenAI недоступна для API-ключа. Проверьте OPENAI_TRANSLATION_MODEL.",
  unsupported_parameter: "Модель OpenAI не принимает один из параметров запроса.",
  unsupported_value: "Модель OpenAI не поддерживает один из параметров запроса.",
  invalid_request_error: "OpenAI отклонил формат запроса.",
  timeout: "Сервис перевода не ответил за установленное время.",
  network_or_response_error: "Ошибка соединения с OpenAI или некорректный ответ сервиса.",
  translation_service_not_configured: "Ключ OpenAI не настроен в Vercel Production.",
  translation_provider_error: "OpenAI отклонил запрос перевода.",
  invalid_ai_draft: "OpenAI вернул неполный или неверный перевод.",
  ai_draft_missing_url: "В переводе отсутствует ссылка из оригинала.",
  brand_or_sku_missing: "В переводе названия утрачен бренд или SKU.",
  origin_forbidden: "Запрос отклонён проверкой адреса сайта. Используйте основной домен магазина.",
  forbidden: "Нет доступа администратора. Войдите в админку снова.",
  source_changed_refresh: "Исходный товар изменился. Обновите список перед переводом.",
  invalid_translation: "Черновик не прошёл проверку полей.",
};

function readableError(details: ApiError, status: number): string {
  const label = ERROR_LABELS[details.code || ""] ||
    ERROR_LABELS[details.error || ""] ||
    "Не удалось подготовить перевод.";
  const suffix = details.providerStatus ? ` (OpenAI HTTP ${details.providerStatus})` :
    status >= 400 ? ` (HTTP ${status})` : "";
  const parameter = details.parameter ? ` [${details.parameter}]` : "";
  return label + suffix + parameter;
}

export default function AdminTranslationsClient() {
  const [kind, setKind] = useState<Kind>("product");
  const [locale, setLocale] = useState<Locale>("kk");
  const [status, setStatus] = useState<Status>("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Result>(EMPTY);
  const [selected, setSelected] = useState<string | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
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
    setCheckedKeys([]);
    setReviewConfirmed(false);
    setName("");
    setSummary("");
    setBody("");
  }, [kind, locale, status, search, page]);

  const item = data.items.find((value) => value.key === selected) || null;
  const checkedItems = data.items.filter((value) => checkedKeys.includes(value.key));
  const checkedMissing = checkedItems.filter((value) => value.state === "MISSING");
  const checkedReview = checkedItems.filter((value) => value.state === "REVIEW" && !!value.translation);
  const allPageChecked = data.items.length > 0 &&
    data.items.every((value) => checkedKeys.includes(value.key));

  const toggleChecked = (key: string) => {
    setCheckedKeys((current) => current.includes(key)
      ? current.filter((value) => value !== key)
      : [...current, key]);
    setReviewConfirmed(false);
  };

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
      if (!response.ok || !result.draft) throw new Error(readableError(result, response.status));
      setName(result.draft.name);
      setSummary(result.draft.summary || "");
      setBody(result.draft.body);
      setMessage("Черновик ИИ получен. Проверьте текст и сохраните перевод.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка подготовки перевода.");
    } finally { setBusy(false); }
  };


  // Generated text is stored as REVIEW, never published without editorial confirmation.
  const prepareMissing = async (selectedOnly = false) => {
    if (bulkBusy || busy) return;
    const requested = selectedOnly ? checkedMissing.length : bulkLimit;
    if (!requested) {
      setMessage("Среди отмеченных карточек нет материалов без перевода.");
      return;
    }
    if (!confirm(
      `Подготовить до ${requested} ИИ-черновиков для ${locale.toUpperCase()}? ` +
      "Расходуется платный API OpenAI. Публикация будет только после ручной проверки.",
    )) return;
    stopBulk.current = false;
    setBulkBusy(true);
    setBulkProgress({ completed: 0, failed: 0 });
    setMessage("");
    let completed = 0;
    let failed = 0;
    let firstError: string | null = null;

    try {
      // Snapshot the missing items before saving drafts. Otherwise pagination
      // shifts on each successful save and skips other missing products.
      const pending: Item[] = selectedOnly ? [...checkedMissing] : [];
      if (!selectedOnly) {
        let currentPage = 1;
        let totalPages = 1;
        while (!stopBulk.current && currentPage <= totalPages && pending.length < bulkLimit) {
          const params = new URLSearchParams({
            kind, locale, status: "MISSING", page: String(currentPage),
          });
          const response = await fetch("/api/admin/translations?" + params, { cache: "no-store" });
          if (!response.ok) {
            const details = await response.json().catch(() => ({})) as ApiError;
            throw new Error(readableError(details, response.status));
          }
          const result = await response.json() as Result;
          pending.push(...result.items.slice(0, bulkLimit - pending.length));
          totalPages = result.pages;
          currentPage += 1;
        }
      }

      const processOne = async (item: Item): Promise<boolean> => {
        try {
          const draftResponse = await fetch("/api/admin/translations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: item.key, locale, sourceHash: item.hash }),
          });
          const draftData = await draftResponse.json().catch(() => ({})) as ApiError & {
            draft?: { name: string; summary: string | null; body: string };
          };
          if (!draftResponse.ok || !draftData.draft)
            throw new Error(readableError(draftData, draftResponse.status));
          const saved = await fetch("/api/admin/translations", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: item.key, locale, sourceHash: item.hash, name: draftData.draft.name,
              summary: draftData.draft.summary || null, body: draftData.draft.body,
              status: "REVIEW",
            }),
          });
          if (!saved.ok) {
            const details = await saved.json().catch(() => ({})) as ApiError;
            throw new Error(readableError(details, saved.status));
          }
          completed += 1;
          setBulkProgress({ completed, failed });
          return true;
        } catch (error) {
          failed += 1;
          firstError ||= error instanceof Error ? error.message : "Ошибка запроса.";
          setBulkProgress({ completed, failed });
          return false;
        }
      };

      // Preflight one material, then stop on failure rather than wasting
      // 20+ calls when the API key, billing, model or CSRF check is broken.
      if (pending.length && !stopBulk.current) {
        const ok = await processOne(pending[0]);
        if (!ok) stopBulk.current = true;
      }
      let nextIndex = 1;
      const worker = async () => {
        while (!stopBulk.current) {
          const current = nextIndex++;
          if (current >= pending.length) return;
          const ok = await processOne(pending[current]);
          if (!ok) stopBulk.current = true;
        }
      };
      if (!stopBulk.current) {
        await Promise.all(Array.from({ length: Math.min(3, pending.length - 1) }, () => worker()));
      }
      setMessage(
        `Подготовлено: ${completed}; ошибок: ${failed}. ` +
        (firstError ? `Причина: ${firstError}. Дальнейшие запросы остановлены.` :
          "Черновики ожидают проверки и публикации."),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Пакетная подготовка прервана.");
    } finally {
      setBulkBusy(false);
      stopBulk.current = false;
      if (selectedOnly) setCheckedKeys([]);
      void load();
    }
  };

  // Only translations explicitly selected and personally reviewed by the
  // administrator can be published. Missing or stale copies are excluded.
  const publishChecked = async () => {
    if (busy || bulkBusy || !reviewConfirmed || !checkedReview.length) return;
    if (!confirm(
      `Опубликовать ${checkedReview.length} проверенных переводов (${locale.toUpperCase()})? ` +
      "Содержимое будет сразу видно покупателям. Подтвердите, что каждый текст проверен."
    )) return;
    setBulkBusy(true);
    setMessage("");
    let published = 0;
    let failed = 0;
    let firstFailure = "";
    try {
      for (const row of checkedReview) {
        if (!row.translation) continue;
        const response = await fetch("/api/admin/translations", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: row.key, locale, sourceHash: row.hash,
            name: row.translation.name, summary: row.translation.summary,
            body: row.translation.body, status: "PUBLISHED",
          }),
        });
        if (response.ok) {
          published++;
        } else {
          failed++;
          const details = await response.json().catch(() => ({})) as ApiError;
          firstFailure ||= readableError(details, response.status);
          // Stop rather than silently publishing further content if source changed.
          break;
        }
      }
      setMessage(
        `Опубликовано переводов: ${published}. Ошибок: ${failed}.` +
        (firstFailure ? ` Причина: ${firstFailure}` : "")
      );
    } catch {
      setMessage(`Опубликовано: ${published}. Ошибка соединения. Проверьте результаты.`);
    } finally {
      setBulkBusy(false);
      setCheckedKeys([]);
      setReviewConfirmed(false);
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
      if (!response.ok) throw new Error(readableError(result, response.status));
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
          : <button type="button" className="btn" disabled={busy} onClick={() => void prepareMissing(false)}>Подготовить ИИ-черновики</button>}
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
        <section className="min-w-0 rounded-2xl border bg-white p-3 scroll-mt-32">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Материалы ({data.count})</h2>
            {loading && <span role="status" className="text-xs text-gray-500">Обновление…</span>}
          </div>
          <p className="mb-2 text-[11px] leading-4 text-gray-500">
            Языки: ✓ опубликован · • черновик · ! устарел · − нет перевода
          </p>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-2 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
              <input type="checkbox" className="h-4 w-4 accent-gray-800"
                checked={allPageChecked} disabled={bulkBusy || !data.items.length}
                onChange={(event) => {
                  setCheckedKeys(event.target.checked ? data.items.map((row) => row.key) : []);
                  setReviewConfirmed(false);
                }} />
              Выбрать все на странице
            </label>
            <button type="button" className="text-xs text-gray-600 underline disabled:opacity-50"
              disabled={bulkBusy || checkedKeys.length === 0}
              onClick={() => { setCheckedKeys([]); setReviewConfirmed(false); }}>
              Снять выбор
            </button>
          </div>
          {/* Natural page scrolling avoids a nested scrollbar covering the list. */}
          <div className="space-y-1">
            {data.items.map((value) => (
              <div key={value.key} className={"flex min-w-0 items-start gap-2 rounded-lg border hover:bg-gray-50 " +
                (selected === value.key ? "border-gray-800 bg-gray-50" : "border-transparent")}>
                <label className="flex h-11 min-w-8 shrink-0 cursor-pointer items-center justify-center pl-2">
                  <input type="checkbox" className="h-4 w-4 accent-gray-800"
                    aria-label={`Выбрать ${value.name}`}
                    checked={checkedKeys.includes(value.key)}
                    disabled={bulkBusy} onChange={() => toggleChecked(value.key)} />
                </label>
                <button type="button" onClick={() => choose(value)}
                  className="flex min-w-0 flex-1 flex-col py-3 pl-1 pr-3 text-left text-sm">
                  <span className="line-clamp-2 font-semibold">{value.name}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-xs text-gray-500">{STATES[value.state as Exclude<Status, "all">] || value.state}</span>
                    <LanguageBadges languages={value.languages} />
                  </span>
                </button>
              </div>
            ))}
            {!loading && !data.items.length && <p className="p-2 text-sm text-gray-500">Материалов нет.</p>}
          </div>
          {checkedKeys.length > 0 && (
            <div className="mt-3 space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm font-medium">Выбрано: {checkedKeys.length}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary"
                  disabled={bulkBusy || busy || !checkedMissing.length}
                  onClick={() => void prepareMissing(true)}>
                  Создать черновики ({checkedMissing.length})
                </button>
                <button type="button" className="btn"
                  disabled={bulkBusy || busy || !reviewConfirmed || !checkedReview.length}
                  onClick={() => void publishChecked()}>
                  Опубликовать проверенные ({checkedReview.length})
                </button>
              </div>
              {checkedReview.length > 0 && (
                <label className="flex cursor-pointer items-start gap-2 text-xs leading-5">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-gray-800"
                    checked={reviewConfirmed} disabled={bulkBusy}
                    onChange={(event) => setReviewConfirmed(event.target.checked)} />
                  Я проверил(а) содержание всех выбранных переводов перед публикацией.
                </label>
              )}
              <p className="text-[11px] text-gray-600">
                Публикуются только переводы со статусом «На проверке».
                Устаревшие и отсутствующие переводы не публикуются.
              </p>
            </div>
          )}
          <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
            <button disabled={bulkBusy || page <= 1} className="btn-secondary" onClick={() => setPage(page - 1)}>Назад</button>
            <span className="text-sm">{page} / {data.pages}</span>
            <button disabled={bulkBusy || page >= data.pages} className="btn-secondary" onClick={() => setPage(page + 1)}>Далее</button>
          </div>
        </section>

        <section className="min-w-0 rounded-2xl border bg-white p-4">
          {item ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">Перевод: {locale === "kk" ? "Қазақша" : "English"}</h2>
                <LanguageBadges languages={item.languages} />
              </div>
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
