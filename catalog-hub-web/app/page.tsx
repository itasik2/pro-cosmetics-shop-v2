import { hubFetch, organizationId, safeHub } from "@/lib/hub";
import { money } from "@/lib/format";
import Link from "next/link";

type Summary = {
  productCount: number;
  stockTotal: number;
  averagePrice: number;
  proposalCount: number;
  changeCount: number;
  profileCount: number;
  recentProducts: Array<{
    id:string;sku:string;title:string;brand:string|null;
    price:number|null;available:number;
  }>;
};

export default async function DashboardPage() {
  // One request to the Edge backend and one SQL statement for the entire overview.
  const result = await safeHub(hubFetch<Summary>(
    "/v1/ui/dashboard?organizationId=" + encodeURIComponent(organizationId),
  ));
  const summary = result.ok ? result.data : null;

  return <div className="page">
    <div className="page-head">
      <div><h1>Обзор</h1><p>Единый центр управления каталогом ProCosmetics.</p></div>
      <div className="flow">
        <span>Источник</span><b>→</b><span>Master Card</span><b>→</b>
        <span>Review</span><b>→</b><span>Каналы</span>
      </div>
    </div>
    {!result.ok && <div className="error">Ошибка загрузки данных: {result.error}</div>}
    <div className="grid metrics">
      <Metric label="Товары" value={summary?.productCount ?? "—"} note="Master Cards" />
      <Metric label="На складах" value={summary?.stockTotal ?? "—"} note="Общее физическое количество" />
      <Metric label="Средняя розничная цена" value={summary ? money(summary.averagePrice) : "—"} note="По всему каталогу" />
      <Metric label="API" value={summary ? "Готов" : "Проверить"} note={summary ? "Соединение и авторизация работают" : result.error || ""} />
    </div>
    <div className="two-col">
      <section className="panel">
        <h2>Последние товары</h2>
        {summary ? <div className="table-wrap"><table>
          <thead><tr><th>Товар</th><th>SKU</th><th>Цена</th><th>Доступно</th></tr></thead>
          <tbody>{summary.recentProducts.map((item) =>
            <tr key={item.id}>
              <td><Link href={"/catalog/" + encodeURIComponent(item.id)}><strong>{item.title}</strong></Link>
                <div className="subtle">{item.brand || "Без бренда"}</div></td>
              <td className="mono">{item.sku}</td>
              <td>{money(item.price)}</td><td>{item.available}</td>
            </tr>)}</tbody>
        </table></div> : <div className="subtle">Не удалось получить последние товары.</div>}
      </section>
      <section className="panel">
        <h2>Очередь операций</h2>
        <div className="list">
          <StatusRow label="Предложения AI" value={summary?.proposalCount ?? "—"} href="/ai" />
          <StatusRow label="Ожидающие изменения" value={summary?.changeCount ?? "—"} href="/changes" />
          <StatusRow label="Медиа-профили" value={summary?.profileCount ?? "—"} href="/media" />
          <StatusRow label="Режим публикации" value="Review-first" />
        </div>
      </section>
    </div>
  </div>;
}
function Metric({ label, value, note }: { label:string;value:React.ReactNode;note:string }) {
  return <div className="metric"><div className="metric-label">{label}</div>
    <div className="metric-value">{value}</div><div className="metric-note">{note}</div></div>;
}
function StatusRow({ label, value, href }: { label:string;value:React.ReactNode;href?:string }) {
  return <div className="list-row"><span>{href?<Link href={href}>{label} →</Link>:label}</span><strong>{value}</strong></div>;
}
