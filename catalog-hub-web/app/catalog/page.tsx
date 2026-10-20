import Link from "next/link";
import { catalogPath, hubFetch, organizationId, safeHub, type HubList, type HubProduct } from "@/lib/hub";
import { money } from "@/lib/format";
import { BatchEnrichment } from "@/components/BatchEnrichment";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; incomplete?: string; category?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() || "";
  const incomplete = params.incomplete === "true";
  const category = params.category?.trim() || "";
  const page = Math.max(1, Number(params.page || 1) || 1);
  const limit = 40;
  const [result, categories] = await Promise.all([
    safeHub(hubFetch<HubList<HubProduct>>(catalogPath({ q, category, incomplete, limit, offset: (page - 1) * limit }))),
    safeHub(hubFetch<{categories:Array<{key:string;name:string;isActive:boolean}>}>(
      "/v1/categories?organizationId=" + encodeURIComponent(organizationId))),
  ]);
  const pagePath = (nextPage: number) => "/catalog?" + new URLSearchParams({
    ...(q ? { q } : {}), ...(category ? { category } : {}),
    ...(incomplete ? { incomplete: "true" } : {}), page: String(nextPage),
  }).toString();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Каталог</h1>
          <p>Карточки товаров, цены и остатки. Пустые поля и фото можно дополнить в карточке товара.</p>
        </div>
        <form className="search">
          <input className="input" name="q" defaultValue={q} placeholder="SKU, название, бренд, штрихкод" />
          <select className="input" name="category" defaultValue={category} aria-label="Категория">
            <option value="">Все категории</option>
            <option value="__uncategorized__">Без категории</option>
            {categories.ok && categories.data.categories.map(item =>
              <option key={item.key} value={item.key}>{item.name}</option>)}
          </select>
          {incomplete && <input type="hidden" name="incomplete" value="true" />}
          <button className="button" type="submit">Найти</button>
        </form>
      </div>

      {!result.ok ? <div className="error">{result.error}</div> : (
        <>
          <div className="kpi-row" style={{marginBottom:12}}>
            <span className="badge blue">Всего: {result.data.pagination.total}</span>
            <a className="button" href="/api/catalog/export" download>Скачать готовые карточки JSON</a>
            {q && <span className="badge">Поиск: {q}</span>}
            {incomplete ? <Link className="button" href={"/catalog?" + new URLSearchParams({...(q ? {q} : {}), ...(category ? {category} : {})}).toString()}>Все карточки</Link>
              : <Link className="button" href={"/catalog?" + new URLSearchParams({...(q ? {q} : {}), ...(category ? {category} : {}), incomplete:"true"}).toString()}>Требуют заполнения</Link>}
          </div>
          {result.data.items.length === 0 && <p className="empty">{incomplete ? "Карточек с пустыми полями или без фото не найдено." : "Товары не найдены."}</p>}
          {Boolean(process.env.OPENAI_API_KEY) &&
            <BatchEnrichment products={result.data.items} />}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Товар</th><th>SKU</th><th>Заполнение</th><th>Категория</th><th>Закупка</th><th>Цена</th><th>Доступно</th></tr></thead>
              <tbody>
                {result.data.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link className="product-cell" href={"/catalog/" + item.id}>
                        {item.images?.[0] ? <img className="thumb" src={item.images[0]} alt="" /> : <span className="placeholder">нет фото</span>}
                        <span><strong>{item.title}</strong><span className="subtle">{item.brand || "Без бренда"}</span></span>
                      </Link>
                    </td>
                    <td className="mono">{item.sku}</td>
                    <td>{missingContentCount(item) ? <Link className="badge" href={"/catalog/" + item.id}>
                      Пустых: {missingContentCount(item)} →</Link> : <span className="badge good">Заполнено</span>}</td>
                    <td>{item.categoryKey || "—"}</td>
                    <td>{money(item.purchasePrice)}</td>
                    <td><strong>{money(item.price)}</strong></td>
                    <td><span className={item.totals.available > 0 ? "badge good" : "badge bad"}>{item.totals.available}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions" style={{marginTop:14}}>
            {page > 1 && <Link className="button" href={pagePath(page-1)}>← Назад</Link>}
            {result.data.pagination.hasMore && <Link className="button" href={pagePath(page+1)}>Дальше →</Link>}
          </div>
        </>
      )}
    </div>
  );
}

function missingContentCount(item: HubProduct) {
  return ([item.brand, item.shortDescription, item.description, item.application, item.ingredients]
    .filter(value => !value?.trim()).length + (item.images?.length ? 0 : 1));
}
