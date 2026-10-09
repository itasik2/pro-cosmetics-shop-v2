import Link from "next/link";
import { hubFetch, organizationId, safeHub } from "@/lib/hub";
import { dateTime } from "@/lib/format";

type Field = { id:string; field:string; risk:"LOW"|"MEDIUM"|"HIGH"; status:string };
type ChangeSet = { id:string; sku:string; sourceType:string; status:string; createdAt:string; fields:Field[]; product?:{title:string;brand:string|null}|null };

export default async function ChangesPage() {
  const result = await safeHub(hubFetch<ChangeSet[]>("/v1/staging/changesets?organizationId="+organizationId+"&limit=100"));
  return <div className="page">
    <div className="page-head"><div><h1>Изменения</h1><p>Preview → Approve → Apply. Цена и остаток не меняются без явного подтверждения.</p></div></div>
    {!result.ok ? <div className="error">{result.error}</div> : result.data.length === 0 ? <div className="panel empty">Очередь изменений пуста.</div> :
      <div className="table-wrap"><table><thead><tr><th>Товар</th><th>Источник</th><th>Поля</th><th>Риск</th><th>Статус</th><th>Создан</th></tr></thead><tbody>
        {result.data.map(cs => {
          const high=cs.fields.filter(f=>f.risk==="HIGH").length;
          const med=cs.fields.filter(f=>f.risk==="MEDIUM").length;
          return <tr key={cs.id}><td><Link href={"/changes/" + encodeURIComponent(cs.id)}><strong>{cs.product?.title || cs.sku}</strong><div className="mono">{cs.sku}</div><span className="subtle">Открыть проверку →</span></Link></td><td>{cs.sourceType}</td><td>{cs.fields.length}</td><td>{high ? <span className="badge bad">HIGH {high}</span> : med ? <span className="badge warn">MEDIUM {med}</span> : <span className="badge good">LOW</span>}</td><td><span className="badge blue">{cs.status}</span></td><td>{dateTime(cs.createdAt)}</td></tr>
        })}</tbody></table></div>}
  </div>;
}
