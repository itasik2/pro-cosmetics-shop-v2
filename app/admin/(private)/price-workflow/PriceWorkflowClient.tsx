"use client";

import { useCallback, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import PriceImportsClient from "../price-imports/PriceImportsClient";
import PriceImportMaintenance from "../price-imports/PriceImportMaintenance";
import AdminEnrichmentClient from "../enrichment/AdminEnrichmentClient";
import EnrichmentPriceScope from "./EnrichmentPriceScope";

export type PriceWorkflowStep = "import" | "enrichment";

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

type Props = {
  initialStep: PriceWorkflowStep;
  initialSuppliers: SupplierOption[];
  initialBrands: BrandOption[];
};

const STEPS: Array<{
  id: PriceWorkflowStep;
  number: number;
  title: string;
  description: string;
}> = [
  {
    id: "import",
    number: 1,
    title: "Импорт прайса",
    description: "Загрузить файл, проверить строки и применить товары и цены.",
  },
  {
    id: "enrichment",
    number: 2,
    title: "Фото, описание и количество",
    description: "Найти официальный источник, выбрать фото, проверить описание и указать остаток.",
  },
];

export default function PriceWorkflowClient({
  initialStep,
  initialSuppliers,
  initialBrands,
}: Props) {
  const [step, setStep] = useState<PriceWorkflowStep>(initialStep);
  const router = useRouter();
  const pathname = usePathname();

  const selectStep = useCallback(
    (nextStep: PriceWorkflowStep) => {
      setStep(nextStep);
      router.replace(`${pathname}?step=${nextStep}`, { scroll: true });
    },
    [pathname, router],
  );

  const currentIndex = STEPS.findIndex((item) => item.id === step);
  const previous = currentIndex > 0 ? STEPS[currentIndex - 1] : null;
  const next = currentIndex < STEPS.length - 1 ? STEPS[currentIndex + 1] : null;

  return (
    <div className="space-y-6 min-w-0">
      <header className="rounded-2xl border bg-white/80 p-4 sm:p-6">
        <h1 className="text-2xl font-bold">Работа с прайсом</h1>
        <p className="mt-2 max-w-3xl text-sm text-gray-600">
          Весь путь подготовки товара находится на одной странице: импорт прайса,
          затем проверка фото и описания с указанием количества. После одобрения
          товар автоматически попадает в очередь черновиков для публикации.
        </p>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {STEPS.map((item) => {
            const active = item.id === step;
            const completed = item.number < STEPS[currentIndex].number;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectStep(item.id)}
                aria-current={active ? "step" : undefined}
                className={`rounded-2xl border p-4 text-left transition ${
                  active
                    ? "border-black bg-black text-white shadow-sm"
                    : "bg-white hover:border-gray-500 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${
                      active
                        ? "border-white bg-white text-black"
                        : completed
                          ? "border-black bg-black text-white"
                          : "border-gray-300 bg-white text-gray-700"
                    }`}
                  >
                    {completed ? "✓" : item.number}
                  </span>
                  <span className="font-semibold">{item.title}</span>
                </div>
                <p className={`mt-3 text-xs ${active ? "text-gray-200" : "text-gray-500"}`}>
                  {item.description}
                </p>
              </button>
            );
          })}
        </div>
      </header>

      <section className="min-w-0" aria-live="polite">
        {step === "import" && (
          <div className="space-y-6">
            <PriceImportsClient
              initialSuppliers={initialSuppliers}
              initialBrands={initialBrands}
            />
            <PriceImportMaintenance />
          </div>
        )}

        {step === "enrichment" && (
          <div className="space-y-4">
            <EnrichmentPriceScope />
            <AdminEnrichmentClient />
          </div>
        )}
      </section>

      <nav className="flex flex-col gap-3 rounded-2xl border bg-white/80 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {previous && (
            <button
              type="button"
              onClick={() => selectStep(previous.id)}
              className="w-full rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 sm:w-auto"
            >
              ← {previous.title}
            </button>
          )}
        </div>

        <div className="text-center text-xs text-gray-500">
          Этап {currentIndex + 1} из {STEPS.length}
        </div>

        <div>
          {next ? (
            <button
              type="button"
              onClick={() => selectStep(next.id)}
              className="w-full rounded-xl bg-black px-4 py-2 text-sm text-white hover:bg-gray-800 sm:w-auto"
            >
              {next.title} →
            </button>
          ) : (
            <button
              type="button"
              onClick={() => router.push("/admin/products")}
              className="w-full rounded-xl bg-black px-4 py-2 text-sm text-white hover:bg-gray-800 sm:w-auto"
            >
              Перейти к черновикам →
            </button>
          )}
        </div>
      </nav>
    </div>
  );
}
