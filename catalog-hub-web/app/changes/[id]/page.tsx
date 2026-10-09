import Link from "next/link";
import { ChangeReview, type ReviewField } from "@/components/ChangeReview";
import { hubFetch, organizationId, safeHub } from "@/lib/hub";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

type ChangeSet = {
  id: string;
  sku: string;
  status: string;
  sourceType: string;
  createdAt: string;
  product?: { id: string; sku: string; title: string };
  fields: ReviewField[];
};

export default async function ChangeDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return <div className="page"><div className="error">Неверный ID изменений.</div></div>;
  const result = await safeHub(
    hubFetch<ChangeSet>(
      "/v1/staging/changesets/" + encodeURIComponent(id) +
      "?organizationId=" + encodeURIComponent(organizationId),
    ),
  );
  if (!result.ok) return <div className="page"><div className="error">{result.error}</div></div>;
  const changes = result.data;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link href="/changes" className="subtle">← Все изменения</Link>
          <h1>Проверка изменений</h1>
          <p>{changes.product?.title || changes.sku} · {changes.sku} · {dateTime(changes.createdAt)}</p>
        </div>
        <div className="actions">
          <span className="badge blue">{changes.status}</span>
          {changes.product?.id && <Link className="button" href={"/catalog/" + encodeURIComponent(changes.product.id)}>Открыть товар</Link>}
        </div>
      </div>
      <ChangeReview key={changes.status} id={changes.id} status={changes.status} fields={changes.fields} />
    </div>
  );
}
