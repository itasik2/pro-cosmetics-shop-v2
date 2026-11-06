/**
 * Walk catalog records in bounded pages without missing products after the
 * first 200. The caller must sort by an immutable key (Product.id).
 */
export async function* paginateImageNormalizationProducts<T extends { id: string }>(
  loadPage: (cursor: string | null) => Promise<T[]>,
  pageSize: number,
): AsyncGenerator<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("invalid_image_pagination_page_size");
  }

  let cursor: string | null = null;
  while (true) {
    const page = await loadPage(cursor);
    if (!page.length) return;
    yield page;
    if (page.length < pageSize) return;

    const nextCursor = page[page.length - 1].id;
    if (!nextCursor || nextCursor === cursor) {
      throw new Error("invalid_image_pagination_cursor");
    }
    cursor = nextCursor;
  }
}
