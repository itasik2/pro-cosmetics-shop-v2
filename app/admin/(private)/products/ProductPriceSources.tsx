import type { ProductPriceSource } from "@/lib/productPriceSources";

function day(value: string) {
  return new Date(value).toLocaleDateString("ru-RU", {
    timeZone: "Asia/Almaty",
  });
}

export default function ProductPriceSources({
  sources = [],
}: {
  sources?: ProductPriceSource[];
}) {
  if (!sources.length)
    return (
      <p className="mt-1 text-xs text-gray-500">Источник прайса не определён</p>
    );
  return (
    <details className="mt-2 min-w-0 text-xs text-gray-600">
      <summary className="cursor-pointer break-words">
        Прайс: {sources[0].fileName}
        {sources[0].sourceDate
          ? ` · от ${day(sources[0].sourceDate)}`
          : " · дата не указана"}
        {sources.length > 1 ? ` · ещё ${sources.length - 1}` : ""}
      </summary>
      <ul className="mt-2 space-y-2">
        {sources.map((source) => (
          <li
            key={source.importId}
            className="rounded-lg border bg-white p-2 break-words"
          >
            <a
              className="font-medium underline"
              href={`/admin/price-workflow?step=import&importId=${encodeURIComponent(source.importId)}`}
              target="_blank"
              rel="noreferrer"
            >
              {source.fileName}
            </a>
            <p>
              Дата прайса:{" "}
              {source.sourceDate ? day(source.sourceDate) : "не указана"} ·
              применён {day(source.appliedAt)}
            </p>
            {source.skus.length > 0 && <p>SKU: {source.skus.join(", ")}</p>}
            <p>
              Строки: {source.rowNumbers.join(", ")}
              {source.pageNumbers.length
                ? ` · страницы: ${source.pageNumbers.join(", ")}`
                : ""}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}
