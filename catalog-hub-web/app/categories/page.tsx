import Link from "next/link";
import {hubFetch,organizationId,safeHub} from "@/lib/hub";
export const dynamic="force-dynamic";
type Category={key:string;name:string;isActive:boolean;productCount:number};
type Product={id:string;sku:string;title:string;brand:string|null;categoryKey:string|null};
export default async function CategoriesPage(){
  const [dictionary,unassigned]=await Promise.all([
    safeHub(hubFetch<{categories:Category[];uncategorized:number}>("/v1/categories?organizationId="+encodeURIComponent(organizationId))),
    safeHub(hubFetch<Product[]>("/v1/categories/unassigned?organizationId="+encodeURIComponent(organizationId))),
  ]);
  return <div className="page">
    <div className="page-head">
      <div>
        <h1>Категории товаров</h1>
        <p>Внутренний справочник Catalog Hub. Категории Kaspi и других площадок сопоставляются отдельно.</p>
      </div>
      <Link href="/catalog" className="button">← Каталог</Link>
    </div>
    {(!dictionary.ok||!unassigned.ok) && <div className="error">
      {!dictionary.ok?dictionary.error:!unassigned.ok?unassigned.error:"Ошибка загрузки"}
    </div>}
    <div className="grid metrics">
      <div className="metric"><div className="metric-label">Активные категории</div>
        <div className="metric-value">{dictionary.ok?dictionary.data.categories.filter(c=>c.isActive).length:"—"}</div>
        <div className="metric-note">Справочник ProCosmetics</div></div>
      <div className="metric"><div className="metric-label">Без категории</div>
        <div className="metric-value">{dictionary.ok?dictionary.data.uncategorized:"—"}</div>
        <div className="metric-note">Требуется проверка вручную</div></div>
    </div>
    <div className="two-col" style={{marginTop:14}}>
      <section className="panel">
        <h2>Справочник</h2>
        {dictionary.ok && <div className="list">{dictionary.data.categories.map(c=>
          <div className="list-row" key={c.key}>
            <strong>{c.name}</strong>
            <span className="badge">{c.productCount} шт. наименований</span>
          </div>)}</div>}
      </section>
      <section className="panel">
        <h2>Товары без категории</h2>
        <p className="subtle">Откройте карточку и запустите поиск данных или выберите категорию вручную. Затем сохраните карточку.</p>
        {unassigned.ok && <div className="list">{unassigned.data.map(p=>
          <div key={p.id} className="list-row">
            <div><Link href={"/catalog/"+encodeURIComponent(p.id)}><strong>{p.title}</strong></Link>
              <div className="mono subtle">{p.sku} · {p.brand||"Без бренда"}</div>
            </div>
            <Link href={"/catalog/"+encodeURIComponent(p.id)} className="button">Открыть →</Link>
          </div>)}</div>}
      </section>
    </div>
  </div>;
}
