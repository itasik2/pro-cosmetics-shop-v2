import { hubFetch, organizationId, safeHub } from "@/lib/hub";
import { isLocalReadOnly } from "@/lib/local-mode";
import { EnrichmentConsole, type EnrichmentJob, type EnrichmentProposal, type SourcePolicy } from "@/components/EnrichmentConsole";
import Link from "next/link";

export default async function AiPage({ searchParams }: { searchParams: Promise<{ sku?: string }> }) {
  if (process.env.PRO_COSMETICS_SHARED_ENRICHMENT_URL) return <div className="page">
    <div className="page-head"><div><h1>Поиск информации и фотографий</h1>
      <p>Откройте товар в каталоге и нажмите «Найти и предложить». Поиск выполняет сервис ProCosmetics, а выбранные данные проходят проверку в Catalog Hub.</p></div></div>
    <Link className="button primary" href="/catalog">Открыть каталог →</Link>
  </div>;
  const query = "?organizationId=" + encodeURIComponent(organizationId);
  const [jobs, proposals, policies, params] = await Promise.all([
    safeHub(hubFetch<EnrichmentJob[]>("/v1/ai/enrichment/jobs" + query + "&limit=50")),
    safeHub(hubFetch<EnrichmentProposal[]>("/v1/ai/enrichment/proposals" + query + "&limit=50")),
    safeHub(hubFetch<SourcePolicy[]>("/v1/source-policies" + query)),
    searchParams,
  ]);
  return <div className="page">
    <div className="page-head"><div><h1>ИИ-обогащение</h1><p>Поиск описаний, состава и фотографий с проверкой источников.</p></div><span className="badge">Применение после согласования</span></div>
    {[jobs, proposals, policies].filter(result => !result.ok).map((result, i) => <p className="error" key={i}>{result.error}</p>)}
    <EnrichmentConsole jobs={jobs.ok ? jobs.data : []} proposals={proposals.ok ? proposals.data : []}
      policies={policies.ok ? policies.data : []} canWrite={!isLocalReadOnly()} initialSku={params.sku?.slice(0, 100) || ""} />
  </div>;
}
