import type { ProductAction } from "@/lib/adminProductActions";

export default function ProductSelectionBar({
  total,
  selected,
  busy,
  progress,
  onSelectAll,
  onClear,
  onAction,
}: {
  total: number;
  selected: number;
  busy: boolean;
  progress: string;
  onSelectAll: () => void;
  onClear: () => void;
  onAction: (action: ProductAction) => void;
}) {
  return (
    <section
      aria-label="Действия с выбранными товарами"
      className="space-y-3 rounded-2xl border bg-[var(--color-surface)] p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary min-h-10 px-3 py-2"
          disabled={busy || !total}
          onClick={onSelectAll}
        >
          Выбрать все найденные ({total})
        </button>
        <button
          type="button"
          className="btn-secondary min-h-10 px-3 py-2"
          disabled={busy || !selected}
          onClick={onClear}
        >
          Снять выбор
        </button>
        <span className="text-sm" role="status">
          Выбрано: {selected} из {total}
        </span>
      </div>
      <p className="text-xs text-gray-500">
        Выбор и действия относятся только к товарам по текущим фильтрам и
        поиску.
      </p>
      {selected > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary min-h-10 px-3 py-2"
            disabled={busy}
            onClick={() => onAction("unpublish")}
          >
            Снять с публикации ({selected})
          </button>
          <button
            type="button"
            className="btn-secondary min-h-10 px-3 py-2"
            disabled={busy}
            onClick={() => onAction("delete")}
          >
            Удалить выбранные ({selected})
          </button>
        </div>
      )}
      {busy && (
        <p role="status" className="text-sm">
          {progress || "Обработка…"}
        </p>
      )}
    </section>
  );
}
