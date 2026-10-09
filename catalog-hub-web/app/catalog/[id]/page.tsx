import { hubFetch, organizationId, safeHub, type HubProduct } from "@/lib/hub";
import { dateTime, money } from "@/lib/format";
import { ProductEditor } from "@/components/ProductEditor";
import Link from "next/link";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await safeHub(
    hubFetch<HubProduct>("/v1/catalog/products/" + encodeURIComponent(id) + "?organizationId=" + organizationId),
  );

  if (!result.ok) return <div className="page"><div className="error">{result.error}</div></div>;
  const item = result.data;

  return (
    <div className="page">
      <div className="page-head">
        <div><span className="eyebrow">{item.sku}</span><h1>{item.title}</h1><p>{item.brand || "Без бренда"} · {item.categoryKey || "Без категории"}</p></div>
        <div className="actions"><Link className="button" href="/catalog">← Каталог</Link><span className="badge good">Master Card</span></div>
      </div>
      <div className="two-col">
        <section className="panel">
          <h2>Карточка</h2>
          <div className="list">
            <TextInfo label="Краткое описание" value={item.shortDescription} />
            <TextInfo label="Описание" value={item.description} />
            <TextInfo label="Применение" value={item.application} />
            <TextInfo label="Состав" value={item.ingredients} />
            <Info label="Штрихкод" value={item.barcode} />
          </div>
        </section>
        <section className="panel">
          <h2>Коммерческие данные</h2>
          <div className="list">
            <Info label="Закупочная цена" value={money(item.purchasePrice)} />
            <Info label="Розничная цена" value={money(item.price)} />
            <Info label="На складе" value={item.totals.stock} />
            <Info label="Доступно" value={item.totals.available} />
            <Info label="Обновлено" value={dateTime(item.updatedAt)} />
          </div>
        </section>
      </div>
      <div style={{marginTop:14}}><ProductEditor product={item} /></div>
      <section className="panel" style={{marginTop:14}}>
        <h2>Изображения</h2>
        <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
          {item.images?.length ? item.images.map((url) => <img key={url} src={url} alt="" style={{width:160,height:160,objectFit:"contain",border:"1px solid var(--line)",borderRadius:12}} />) : <div className="empty">Изображений нет</div>}
        </div>
      </section>
    </div>
  );
}

function TextInfo({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="product-detail-block">
      <div className="product-detail-label">{label}</div>
      <p className="product-detail-body">{value?.trim() || "—"}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="list-row"><span className="subtle">{label}</span><span style={{maxWidth:"68%",textAlign:"right",whiteSpace:"pre-wrap"}}>{value || "—"}</span></div>;
}
