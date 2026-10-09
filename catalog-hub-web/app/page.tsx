import { hubFetch, organizationId, safeHub, type HubList, type HubProduct } from "@/lib/hub";
import { money } from "@/lib/format";

export default async function DashboardPage() {
  const [health, ready, products, proposals, changes, profiles] =
    await Promise.all([
      safeHub(hubFetch<Record<string, unknown>>("/health")),
      safeHub(hubFetch<Record<string, unknown>>("/ready")),
      safeHub(hubFetch<HubList<HubProduct>>(
        "/v1/catalog/products?organizationId=" + organizationId + "&limit=6",
      )),
      safeHub(hubFetch<unknown[]>(
        "/v1/ai/enrichment/proposals?organizationId=" + organizationId + "&status=PENDING&limit=20",
      )),
      safeHub(hubFetch<unknown[]>(
        "/v1/staging/changesets?organizationId=" + organizationId + "&limit=20",
      )),
      safeHub(hubFetch<unknown[]>(
        "/v1/media/profiles?organizationId=" + organizationId,
      )),
    ]);

  const items = products.ok ? products.data.items : [];
  const total = products.ok ? products.data.pagination.total : 0;
  const totalStock = items.reduce((sum, item) => sum + item.totals.stock, 0);
  const avgPrice = items.length
    ? Math.round(items.reduce((sum, item) => sum + (item.price || 0), 0) / items.length)
    : 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Обзор</h1>
          <p>Единый центр управления каталогом ProCosmetics.</p>
        </div>
        <div className="flow">
          <span>Источник</span><b>→</b><span>Master Card</span><b>→</b>
          <span>Review</span><b>→</b><span>Каналы</span>
        </div>
      </div>

      <div className="grid metrics">
        <Metric label="Master Cards" value={total} note="Текущий каталог" />
        <Metric label="Остаток выборки" value={totalStock} note="По первым товарам" />
        <Metric label="Средняя цена выборки" value={money(avgPrice)} note="Розничная" />
        <Metric
          label="API"
          value={health.ok && ready.ok ? "Готов" : "Проверить"}
          note={ready.ok ? "Database + auth" : ready.error || health.error || ""}
        />
      </div>

      <div className="two-col">
        <section className="panel">
          <h2>Последние товары</h2>
          {products.ok ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Товар</th><th>SKU</th><th>Цена</th><th>Остаток</th></tr></thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td><strong>{item.title}</strong><div className="subtle">{item.brand || "Без бренда"}</div></td>
                      <td className="mono">{item.sku}</td>
                      <td>{money(item.price)}</td>
                      <td>{item.totals.available}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="error">{products.error}</div>}
        </section>

        <section className="panel">
          <h2>Очередь операций</h2>
          <div className="list">
            <StatusRow label="AI-предложения" value={proposals.ok ? proposals.data.length : "—"} />
            <StatusRow label="ChangeSet" value={changes.ok ? changes.data.length : "—"} />
            <StatusRow label="Медиа-профили" value={profiles.ok ? profiles.data.length : "—"} />
            <StatusRow label="Режим публикации" value="Review-first" />
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: React.ReactNode; note: string }) {
  return <div className="metric"><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></div>;
}
function StatusRow({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="list-row"><span>{label}</span><strong>{value}</strong></div>;
}
