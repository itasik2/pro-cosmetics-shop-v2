"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

type ImportStatus = "UPLOADED" | "PARSING" | "REVIEW" | "APPLIED" | "FAILED";
type RowAction = "CREATE" | "UPDATE" | "SKIP" | "ERROR" | "MANUAL_REVIEW";
type ParserMode = "AUTO" | "ANGIOPHARM_PDF" | "GENERIC_PDF";

type SupplierOption = {
  id: string;
  name: string;
  slug: string;
  siteUrl: string | null;
};

type BrandOption = {
  id: string;
  name: string;
  slug: string;
};

type ParsedData = {
  brand?: string;
  normalizedName?: string;
  originalName?: string;
  volumeLabel?: string;
  sourcePrice?: number;
  salePrice?: number;
  productLineName?: string | null;
  category?: string;
  warnings?: string[];
};

type ImportRow = {
  id: string;
  rowNumber: number;
  pageNumber: number | null;
  supplierSku: string | null;
  productId: string | null;
  action: RowAction;
  confidence: number;
  selected: boolean;
  error: string | null;
  parsedData: ParsedData | null;
};

type PriceImport = {
  id: string;
  fileName: string;
  sourceDate: string | null;
  status: ImportStatus;
  priceMode: string;
  markupPercent: number;
  roundingStep: number;
  totalRows: number;
  validRows: number;
  createdRows: number;
  updatedRows: number;
  skippedRows: number;
  errorRows: number;
  createdAt: string;
  appliedAt: string | null;
  supplier: { id: string; name: string; slug: string };
  rows: ImportRow[];
};

type ImportListItem = Omit<PriceImport, "rows"> & {
  _count: { rows: number };
};

type Props = {
  initialSuppliers: SupplierOption[];
  initialBrands: BrandOption[];
};

const ACTION_LABEL: Record<RowAction, string> = {
  CREATE: "Создать",
  UPDATE: "Обновить",
  SKIP: "Пропустить",
  ERROR: "Ошибка",
  MANUAL_REVIEW: "Проверить вручную",
};

function formatMoney(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString("ru-RU")} ₸` : "—";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ru-RU");
}

function normalizeLookup(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").trim();
}

async function readJson(res: Response) {
  return res.json().catch(() => ({} as any));
}

export default function PriceImportsClient({
  initialSuppliers,
  initialBrands,
}: Props) {
  const [imports, setImports] = useState<ImportListItem[]>([]);
  const [current, setCurrent] = useState<PriceImport | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [supplierName, setSupplierName] = useState("");
  const [supplierSiteUrl, setSupplierSiteUrl] = useState("");
  const [defaultBrand, setDefaultBrand] = useState("");
  const [parserMode, setParserMode] = useState<ParserMode>("AUTO");
  const [priceMode, setPriceMode] = useState("PRICE_AS_IS");
  const [markupPercent, setMarkupPercent] = useState("20");
  const [roundingStep, setRoundingStep] = useState("100");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadImports() {
    const res = await fetch("/api/admin/price-imports", { cache: "no-store" });
    if (res.ok) setImports(await res.json());
  }

  async function openImport(id: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/price-imports/${id}`, { cache: "no-store" });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || String(res.status));
      setCurrent(data);
    } catch (error: any) {
      setMessage(`Ошибка загрузки импорта: ${error?.message || "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadImports();
  }, []);

  function changeSupplier(value: string) {
    setSupplierName(value);
    const existing = initialSuppliers.find(
      (supplier) => normalizeLookup(supplier.name) === normalizeLookup(value),
    );
    if (existing?.siteUrl) setSupplierSiteUrl(existing.siteUrl);
  }

  function changeParser(value: ParserMode) {
    setParserMode(value);
    if (value === "ANGIOPHARM_PDF" && !defaultBrand.trim()) {
      setDefaultBrand("ANGIOPHARM");
    }
  }

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!supplierName.trim()) {
      setMessage("Укажите поставщика");
      return;
    }
    if (!file) {
      setMessage("Выберите PDF-файл прайса");
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("supplierName", supplierName.trim());
      form.append("supplierSiteUrl", supplierSiteUrl.trim());
      form.append("defaultBrand", defaultBrand.trim());
      form.append("parserMode", parserMode);
      form.append("priceMode", priceMode);
      form.append("markupPercent", markupPercent);
      form.append("roundingStep", roundingStep);

      const res = await fetch("/api/admin/price-imports/upload", {
        method: "POST",
        body: form,
      });
      const data = await readJson(res);

      if (res.status === 409 && data?.importId) {
        setMessage("Этот файл уже загружался для выбранного поставщика. Открыт существующий импорт.");
        await openImport(String(data.importId));
        await loadImports();
        return;
      }
      if (!res.ok) {
        throw new Error(data?.message || data?.error || String(res.status));
      }

      setCurrent(data.import);
      setMessage(
        `Распознано строк: ${data.import?.totalRows ?? 0}. Шаблон: ${data.parser?.id || "неизвестен"}.`,
      );
      await loadImports();
    } catch (error: any) {
      setMessage(`Ошибка импорта: ${error?.message || "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  function patchRow(id: string, patch: Partial<Pick<ImportRow, "selected" | "action">>) {
    setCurrent((value) =>
      value
        ? {
            ...value,
            rows: value.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
          }
        : value,
    );
  }

  function selectAll(selected: boolean) {
    setCurrent((value) =>
      value
        ? {
            ...value,
            rows: value.rows.map((row) => ({
              ...row,
              selected: row.action === "ERROR" ? false : selected,
            })),
          }
        : value,
    );
  }

  async function saveRows(showMessage = true) {
    if (!current) return false;
    setSaving(true);
    if (showMessage) setMessage(null);

    try {
      const res = await fetch(`/api/admin/price-imports/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: current.rows.map((row) => ({
            id: row.id,
            selected: row.selected,
            action: row.action,
          })),
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || String(res.status));
      setCurrent(data);
      if (showMessage) setMessage("Настройки строк сохранены");
      return true;
    } catch (error: any) {
      setMessage(`Ошибка сохранения: ${error?.message || "unknown"}`);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function applyImport() {
    if (!current || current.status !== "REVIEW") return;
    if (!confirm("Создать и обновить выбранные товары?")) return;

    setApplying(true);
    setMessage(null);
    try {
      const saved = await saveRows(false);
      if (!saved) return;

      const res = await fetch(`/api/admin/price-imports/${current.id}/apply`, {
        method: "POST",
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || String(res.status));
      setCurrent(data.import);
      setMessage(
        `Готово: создано ${data.import.createdRows}, обновлено ${data.import.updatedRows}, ошибок ${data.import.errorRows}`,
      );
      await loadImports();
    } catch (error: any) {
      setMessage(`Ошибка применения: ${error?.message || "unknown"}`);
    } finally {
      setApplying(false);
    }
  }

  const selectedCount = useMemo(
    () => current?.rows.filter((row) => row.selected).length ?? 0,
    [current],
  );

  return (
    <div className="space-y-6 min-w-0">
      <div>
        <h1 className="text-2xl font-bold">Импорт прайсов</h1>
        <p className="mt-1 text-sm text-gray-500">
          Поставщик и бренд указываются раздельно. Один PDF может содержать несколько
          брендов, когда в таблице есть колонка «Бренд». Все новые товары создаются
          неопубликованными.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <form onSubmit={upload} className="rounded-2xl border p-4 space-y-4 min-w-0">
          <h2 className="font-semibold">Загрузить прайс поставщика</h2>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm text-gray-600">Поставщик *</span>
              <input
                list="price-import-suppliers"
                className="w-full rounded-xl border px-3 py-2"
                placeholder="Например, ТЭКОМ"
                value={supplierName}
                onChange={(event) => changeSupplier(event.target.value)}
                required
              />
              <datalist id="price-import-suppliers">
                {initialSuppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.name} />
                ))}
              </datalist>
            </label>

            <label className="space-y-1">
              <span className="text-sm text-gray-600">Сайт поставщика</span>
              <input
                type="url"
                className="w-full rounded-xl border px-3 py-2"
                placeholder="https://supplier.example"
                value={supplierSiteUrl}
                onChange={(event) => setSupplierSiteUrl(event.target.value)}
              />
            </label>

            <label className="space-y-1">
              <span className="text-sm text-gray-600">Шаблон файла</span>
              <select
                className="w-full rounded-xl border px-3 py-2 bg-white"
                value={parserMode}
                onChange={(event) => changeParser(event.target.value as ParserMode)}
              >
                <option value="AUTO">Определить автоматически</option>
                <option value="ANGIOPHARM_PDF">ANGIOPHARM PDF</option>
                <option value="GENERIC_PDF">Обычная PDF-таблица</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-sm text-gray-600">Бренд по умолчанию</span>
              <input
                list="price-import-brands"
                className="w-full rounded-xl border px-3 py-2"
                placeholder="Не нужен, если в PDF есть колонка Бренд"
                value={defaultBrand}
                onChange={(event) => setDefaultBrand(event.target.value)}
              />
              <datalist id="price-import-brands">
                {initialBrands.map((brand) => (
                  <option key={brand.id} value={brand.name} />
                ))}
              </datalist>
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-sm text-gray-600">PDF-файл *</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="w-full rounded-xl border px-3 py-2 bg-white"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1">
              <span className="text-sm text-gray-600">Правило цены</span>
              <select
                className="w-full rounded-xl border px-3 py-2 bg-white"
                value={priceMode}
                onChange={(event) => setPriceMode(event.target.value)}
              >
                <option value="PRICE_AS_IS">Цена прайса = цена сайта</option>
                <option value="MARKUP_PERCENT">Добавить наценку</option>
                <option value="SOURCE_ONLY">Только закупочная цена</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-sm text-gray-600">Наценка, %</span>
              <input
                type="number"
                min={0}
                max={500}
                className="w-full rounded-xl border px-3 py-2"
                value={markupPercent}
                disabled={priceMode !== "MARKUP_PERCENT"}
                onChange={(event) => setMarkupPercent(event.target.value.replace(/[^\d]/g, ""))}
              />
            </label>

            <label className="space-y-1">
              <span className="text-sm text-gray-600">Округление</span>
              <select
                className="w-full rounded-xl border px-3 py-2 bg-white"
                value={roundingStep}
                onChange={(event) => setRoundingStep(event.target.value)}
              >
                <option value="1">Без округления</option>
                <option value="10">До 10 ₸</option>
                <option value="50">До 50 ₸</option>
                <option value="100">До 100 ₸</option>
              </select>
            </label>
          </div>

          <button
            type="submit"
            disabled={busy || !file || !supplierName.trim()}
            className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
          >
            {busy ? "Разбор файла…" : "Загрузить и проанализировать"}
          </button>
        </form>

        <section className="rounded-2xl border p-4 min-w-0">
          <h2 className="font-semibold">Последние импорты</h2>
          <div className="mt-3 space-y-2 max-h-72 overflow-auto">
            {imports.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openImport(item.id)}
                className="w-full rounded-xl border p-3 text-left hover:bg-gray-50"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium break-all">{item.fileName}</span>
                  <StatusBadge status={item.status} />
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {item.supplier.name} • {formatDate(item.createdAt)} • строк: {item._count.rows}
                </div>
              </button>
            ))}
            {imports.length === 0 && (
              <div className="text-sm text-gray-500">Импортов пока нет</div>
            )}
          </div>
        </section>
      </div>

      {message && <div className="rounded-xl border bg-gray-50 px-4 py-3 text-sm">{message}</div>}

      {current && (
        <section className="space-y-4 min-w-0">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold break-all">{current.fileName}</h2>
                <StatusBadge status={current.status} />
              </div>
              <div className="mt-1 text-sm text-gray-500">
                {current.supplier.name} • дата прайса: {current.sourceDate ? new Date(current.sourceDate).toLocaleDateString("ru-RU") : "не найдена"}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                onClick={() => selectAll(true)}
              >
                Выбрать всё
              </button>
              <button
                type="button"
                className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                onClick={() => selectAll(false)}
              >
                Снять всё
              </button>
              <button
                type="button"
                disabled={saving || current.status !== "REVIEW"}
                className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                onClick={() => saveRows(true)}
              >
                {saving ? "Сохранение…" : "Сохранить выбор"}
              </button>
              <button
                type="button"
                disabled={applying || current.status !== "REVIEW" || selectedCount === 0}
                className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                onClick={applyImport}
              >
                {applying ? "Применение…" : `Применить (${selectedCount})`}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Всего строк" value={current.totalRows} />
            <Stat label="Распознано" value={current.validRows} />
            <Stat label="Создано" value={current.createdRows} />
            <Stat label="Обновлено" value={current.updatedRows} />
            <Stat label="Пропущено" value={current.skippedRows} />
            <Stat label="Ошибки" value={current.errorRows} />
          </div>

          <div className="overflow-x-auto rounded-2xl border min-w-0">
            <table className="min-w-[1320px] w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-600">
                <tr>
                  <th className="p-3">Выбор</th>
                  <th className="p-3">Строка</th>
                  <th className="p-3">Действие</th>
                  <th className="p-3">Бренд</th>
                  <th className="p-3">Артикул</th>
                  <th className="p-3">Название</th>
                  <th className="p-3">Объём</th>
                  <th className="p-3">Цена прайса</th>
                  <th className="p-3">Цена сайта</th>
                  <th className="p-3">Линия</th>
                  <th className="p-3">Точность</th>
                  <th className="p-3">Примечание</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {current.rows.map((row) => {
                  const parsed = row.parsedData || {};
                  const warningText = [
                    ...(parsed.warnings || []),
                    ...(row.error ? [row.error] : []),
                  ].join(", ");

                  return (
                    <tr key={row.id} className={row.action === "ERROR" ? "bg-red-50" : ""}>
                      <td className="p-3 align-top">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          disabled={current.status !== "REVIEW" || row.action === "ERROR"}
                          onChange={(event) => patchRow(row.id, { selected: event.target.checked })}
                        />
                      </td>
                      <td className="p-3 align-top whitespace-nowrap">
                        стр. {row.pageNumber ?? "?"}, №{row.rowNumber}
                      </td>
                      <td className="p-3 align-top">
                        <select
                          className="rounded-lg border px-2 py-1 bg-white"
                          value={row.action}
                          disabled={current.status !== "REVIEW" || row.action === "ERROR"}
                          onChange={(event) => {
                            const action = event.target.value as RowAction;
                            patchRow(row.id, {
                              action,
                              selected: action !== "SKIP" && action !== "MANUAL_REVIEW",
                            });
                          }}
                        >
                          <option value="CREATE">Создать</option>
                          <option value="UPDATE">Обновить</option>
                          <option value="SKIP">Пропустить</option>
                          <option value="MANUAL_REVIEW">Проверить вручную</option>
                          {row.action === "ERROR" && <option value="ERROR">Ошибка</option>}
                        </select>
                      </td>
                      <td className="p-3 align-top font-medium">{parsed.brand || "—"}</td>
                      <td className="p-3 align-top font-mono">{row.supplierSku || "—"}</td>
                      <td className="p-3 align-top max-w-sm">
                        <div className="font-medium">{parsed.normalizedName || parsed.originalName || "—"}</div>
                        <div className="text-xs text-gray-500">{parsed.category || ""}</div>
                      </td>
                      <td className="p-3 align-top whitespace-nowrap">{parsed.volumeLabel || "—"}</td>
                      <td className="p-3 align-top whitespace-nowrap">{formatMoney(parsed.sourcePrice)}</td>
                      <td className="p-3 align-top whitespace-nowrap">{formatMoney(parsed.salePrice)}</td>
                      <td className="p-3 align-top">{parsed.productLineName || "—"}</td>
                      <td className="p-3 align-top whitespace-nowrap">{row.confidence}%</td>
                      <td className="p-3 align-top text-xs text-gray-500 max-w-xs break-words">
                        {warningText || ACTION_LABEL[row.action]}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ImportStatus }) {
  const label: Record<ImportStatus, string> = {
    UPLOADED: "Загружен",
    PARSING: "Разбор",
    REVIEW: "На проверке",
    APPLIED: "Применён",
    FAILED: "Ошибка",
  };

  return (
    <span className="rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap">
      {label[status]}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}
