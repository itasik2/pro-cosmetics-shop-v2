import { z } from "zod";
import { catalogBatch } from "./catalogBatch";
import { CATALOG_BATCH_SIZE } from "./progressiveList";
import type { CatalogProductRow, CatalogSource } from "./catalogTypes";

const flag = z.union([z.literal(""), z.literal("1")]);
const slugs = z.array(z.string().max(200)).max(100);
const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("catalog"), query: z.object({
    brandSlugs: slugs, categorySlugs: slugs, sort: z.union([z.literal(""), z.literal("new")]),
    fav: flag, instock: flag, searchQuery: z.string().max(120), care: z.string().max(200), maxPrice: z.number().int().positive().max(1000000).nullable(),
  }) }),
  z.object({ kind: z.literal("brand"), slug: z.string().min(1).max(200) }),
]);
const requestSchema = z.object({ source: sourceSchema,
  cursor: z.object({ id: z.string().min(1).max(128), createdAt: z.string().datetime() }).optional(),
  favorites: z.array(z.string().min(1).max(128)).max(2000).default([]),
}).strict();

export function createCatalogPost(load: (source: CatalogSource) => Promise<CatalogProductRow[]>) {
  return async (request: Request) => {
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    const headers = { "Cache-Control": "private, no-store, max-age=0" };
    if (!parsed.success) return Response.json({ error: "Некорректные параметры каталога" }, { status: 400, headers });
    try {
      const { source, cursor, favorites } = parsed.data;
      const products = await load(source);
      return Response.json(catalogBatch(products, CATALOG_BATCH_SIZE, cursor,
        source.kind === "catalog" && source.query.fav === "1" ? favorites : undefined), { headers });
    } catch {
      return Response.json({ error: "Не удалось загрузить товары. Попробуйте ещё раз." }, { status: 503, headers });
    }
  };
}
