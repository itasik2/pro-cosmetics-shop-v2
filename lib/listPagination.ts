export const CATALOG_PAGE_SIZE = 24;
export const ADMIN_PRODUCT_PAGE_SIZE = 30;

export function paginateItems<T>(items: readonly T[], requestedPage: number, pageSize: number) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("invalid_page_size");
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.max(1, Math.min(pageCount, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1));
  const offset = (page - 1) * pageSize;
  return { items: items.slice(offset, offset + pageSize), page, pageCount, total,
    start: total ? offset + 1 : 0, end: Math.min(offset + pageSize, total) };
}
