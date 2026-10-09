import { hubFetch, organizationId, safeHub } from "@/lib/hub";
import { dateTime } from "@/lib/format";

type Proposal = {
  id: string;
  confidence: number;
  status: string;
  sourceUrl: string;
  title?: string | null;
  createdAt: string;
  product: { id: string; sku: string; title: string; brand: string | null };
};

export default async function AiPage() {
  const [proposals, suppliers, policies] = await Promise.all([
    safeHub(hubFetch<Proposal[]>("/v1/ai/enrichment/proposals?organizationId="+organizationId+"&limit=50")),
    safeHub(hubFetch<any[]>("/v1/suppliers?organizationId="+organizationId)),
    safeHub(hubFetch<any[]>("/v1/source-policies?organizationId="+organizationId)),
  ]);

  return <div className="page">
    <div className="page-head"><div><h1>AI-обогащение</h1><p>Поиск фактов, описаний и изображений с review перед применением.</p></div><span className="badge warn">Пока только просмотр</span></div>
    <p className="subtle">Автоматический запуск поиска и обработка предложений через этот экран ещё не подключены.</p>
    <div className="grid metrics">
      <Metric label="Предложения" value={proposals.ok ? proposals.data.length : "—"} />
      <Metric label="Поставщики" value={suppliers.ok ? suppliers.data.length : "—"} />
      <Metric label="Доверенные источники" value={policies.ok ? policies.data.length : "—"} />
      <Metric label="Автопубликация" value="Выкл." />
    </div>
    <div className="two-col">
      <section className="panel">
        <h2>Предложения AI</h2>
        {!proposals.ok ? <div className="error">{proposals.error}</div> : proposals.data.length === 0 ? <div className="empty">Пока нет предложений.</div> :
          <div className="list">{proposals.data.map(p => <div className="list-row" key={p.id}><div><strong>{p.product.title}</strong><div className="subtle">{p.product.sku} · {p.product.brand || "—"}</div><div className="subtle">{dateTime(p.createdAt)}</div></div><div style={{textAlign:"right"}}><span className={p.confidence >= 80 ? "badge good" : p.confidence >= 60 ? "badge warn" : "badge bad"}>{p.confidence}%</span><div className="subtle">{p.status}</div></div></div>)}</div>}
      </section>
      <section className="panel">
        <h2>Политика AI</h2>
        <div className="list">
          <div className="list-row"><span>Факты</span><strong>Только источники</strong></div>
          <div className="list-row"><span>Неуверенные данные</span><strong>На проверку</strong></div>
          <div className="list-row"><span>Изображения</span><strong>Выбор вручную</strong></div>
          <div className="list-row"><span>Применение</span><strong>ChangeSet</strong></div>
        </div>
      </section>
    </div>
  </div>;
}
function Metric({label,value}:{label:string;value:React.ReactNode}) { return <div className="metric"><div className="metric-label">{label}</div><div className="metric-value">{value}</div></div>; }
