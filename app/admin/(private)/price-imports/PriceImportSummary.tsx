import type { PriceReconciliation } from "@/lib/price-import/reconciliationPolicy";

export default function PriceImportSummary({
  report,
}: {
  report: PriceReconciliation;
}) {
  return (
    <section
      aria-label="Сверка прайса с каталогом"
      className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4"
    >
      <h3 className="font-semibold">Изменения в прайсе</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Цены применены автоматически", report.automaticApplied],
          ["Снижения ждут подтверждения", report.decreases],
          ["Новые позиции и варианты", report.newRows],
          ["Позиций нет в этом прайсе", report.missing.length],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border bg-white p-3">
            <p className="text-xs text-gray-600">{label}</p>
            <p className="mt-1 text-xl font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-600">
        Повышения цены из более свежего прайса применяются автоматически при
        точном совпадении SKU и данных позиции. Снижения подтверждает
        администратор. Новые позиции создаются черновиками с пометкой «Новинка».
      </p>
      {report.decreases > 0 && (
        <p className="text-sm">
          Откройте «Снижения цен», выберите позиции и подтвердите суммы. Чтобы
          оставить текущую цену, укажите действие «Пропустить».
        </p>
      )}
      {report.missing.length > 0 && (
        <details className="rounded-xl border bg-white p-3" open>
          <summary className="cursor-pointer font-medium text-sm">
            Нет в этом прайсе · {report.missing.length} · из них с остатком:{" "}
            {report.missing.filter((row) => row.stock > 0).length}
          </summary>
          <p className="my-3 text-xs text-gray-600">
            Это наличие у поставщика по загруженному файлу. Товары и варианты
            сохранены в каталоге, фактические остатки и публикация не изменены.
            В неполном прайсе часть ассортимента может отсутствовать.
          </p>
          <div className="max-h-80 overflow-auto">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">Товар / вариант</th>
                  <th className="p-2">SKU</th>
                  <th className="p-2">Остаток магазина</th>
                  <th className="p-2">Цена сайта</th>
                </tr>
              </thead>
              <tbody>
                {[...report.missing]
                  .sort((a, b) => b.stock - a.stock)
                  .map((row) => (
                    <tr
                      key={row.productId + ":" + row.variantId}
                      className="border-t"
                    >
                      <td className="p-2">
                        {row.name}
                        {row.label ? ` · ${row.label}` : ""}
                        <span className="block text-xs text-gray-500">
                          {row.brand}
                        </span>
                      </td>
                      <td className="p-2 font-mono">{row.sku}</td>
                      <td className="p-2">{row.stock} шт.</td>
                      <td className="p-2 whitespace-nowrap">
                        {row.price.toLocaleString("ru-RU")} ₸
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
