import Link from "next/link";
import { catalogPath, hubFetch, safeHub, type HubList, type HubProduct } from "@/lib/hub";
import { money } from "@/lib/format";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() || "";
  const page = Math.max(1, Number(params.page || 1) || 1);
  const limit = 40;
  const result = await safeHub(
    hubFetch<HubList<HubProduct>>(catalogPath({ q, limit, offset: (page - 1) * limit })),
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Каталог</h1>
          <p>Master Card — единый источник карточек, цен и остатков.</p>
        </div>
        <form className="search">
          <input className="input" name="q" defaultValue={q} placeholder="SKU, название, бренд, штрихкод" />
          <button className="button" type="submit">Найти</button>
        </form>
      </div>

      {!result.ok ? <div className="error">{result.error}</div> : (
        <>
          <div className="kpi-row" style={{marginBottom:12}}>
            <span className="badge blue">Всего: {result.data.pagination.total}</span>
            {q && <span className="badge">Поиск: {q}</span>}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Товар</th><th>SKU</th><th>Категория</th><th>Закупка</th><th>Цена</th><th>Доступно</th></tr></thead>
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
            {page > 1 && <Link className="button" href={"/catalog?q="+encodeURIComponent(q)+"&page="+(page-1)}>← Назад</Link>}
            {result.data.pagination.hasMore && <Link className="button" href={"/catalog?q="+encodeURIComponent(q)+"&page="+(page+1)}>Дальше →</Link>}
          </div>
        </>
      )}
    </div>
  );
}
