import { hubFetch, organizationId, safeHub } from "@/lib/hub";

export default async function SettingsPage() {
  const [suppliers, policies, health] = await Promise.all([
    safeHub(hubFetch<any[]>("/v1/suppliers?organizationId="+organizationId)),
    safeHub(hubFetch<any[]>("/v1/source-policies?organizationId="+organizationId)),
    safeHub(hubFetch<Record<string,unknown>>("/health")),
  ]);
  return <div className="page">
    <div className="page-head"><div><h1>Настройки</h1><p>Организация, поставщики, доверенные источники и состояние сервиса.</p></div></div>
    <div className="two-col">
      <section className="panel"><h2>Поставщики</h2>{!suppliers.ok?<div className="error">{suppliers.error}</div>:<div className="list">{suppliers.data.map((s:any)=><div className="list-row" key={s.id}><span><strong>{s.name}</strong><div className="mono">{s.code}</div></span><span className="badge">{s._count?.products ?? 0} товаров</span></div>)}</div>}</section>
      <section className="panel"><h2>Доверенные источники</h2>{!policies.ok?<div className="error">{policies.error}</div>:<div className="list">{policies.data.slice(0,20).map((p:any)=><div className="list-row" key={p.id}><span><strong>{p.domain}</strong><div className="subtle">{p.supplier?.name}</div></span><span className={p.sourceType==="OFFICIAL_SITE"?"badge good":"badge"}>{p.sourceType}</span></div>)}</div>}</section>
    </div>
    <section className="panel" style={{marginTop:14}}><h2>Сервис</h2><pre className="mono" style={{whiteSpace:"pre-wrap"}}>{JSON.stringify(health.ok?health.data:{error:health.error},null,2)}</pre></section>
  </div>;
}
