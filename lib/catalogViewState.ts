import type { CatalogBatch } from "./catalogTypes";

type View = { batch: CatalogBatch; anchor?: string };

// In-memory navigation state only. A full reload starts with fresh server data.
export function createCatalogViewCache(limit = 8) {
  const views = new Map<string, View>();
  const put = (key: string, view: View) => {
    views.delete(key);
    views.set(key, view);
    while (views.size > limit) views.delete(views.keys().next().value!);
  };
  return {
    read(key: string) { const view = views.get(key); return view?.anchor ? view : undefined; },
    save(key: string, batch: CatalogBatch) { put(key, { batch, anchor: views.get(key)?.anchor }); },
    remember(key: string, batch: CatalogBatch, anchor: string) { put(key, { batch, anchor }); },
    restored(key: string, anchor: string) {
      const view = views.get(key);
      if (view?.anchor === anchor) views.set(key, { batch: view.batch });
    },
  };
}

export const catalogViewCache = createCatalogViewCache();
