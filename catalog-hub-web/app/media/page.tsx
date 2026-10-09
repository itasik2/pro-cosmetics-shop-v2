import { hubFetch, organizationId, safeHub } from "@/lib/hub";

type Profile = {
  id:string; code:string; name:string; target:string|null; width:number; height:number;
  mode:string; format:string; quality:number; background:string; allowUpscale:boolean;
  removeBackground:boolean; trim:boolean; isActive:boolean;
};

export default async function MediaPage() {
  const profiles = await safeHub(hubFetch<Profile[]>("/v1/media/profiles?organizationId="+organizationId+"&activeOnly=true"));
  return <div className="page">
    <div className="page-head"><div><h1>Медиа</h1><p>Оригиналы и независимые варианты для сайта и маркетплейсов.</p></div><span className="badge blue">Original-first</span></div>
    {!profiles.ok ? <div className="error">{profiles.error}</div> :
      <div className="profile-grid">{profiles.data.map(p => <article className="profile-card" key={p.id}><div className="kpi-row"><span className="badge blue">{p.target || "CUSTOM"}</span><span className="badge">{p.format.toUpperCase()}</span></div><h2 style={{fontSize:16,marginBottom:0}}>{p.name}</h2><div className="profile-size">{p.width} × {p.height}</div><div className="subtle">Режим: {p.mode} · качество {p.quality}%</div><div className="subtle">Upscale: {p.allowUpscale ? "да" : "нет"} · trim: {p.trim ? "да" : "нет"}</div><div className="subtle">Удаление фона: {p.removeBackground ? "да" : "нет"}</div></article>)}</div>}
    <section className="panel" style={{marginTop:14}}>
      <h2>Поток обработки</h2>
      <div className="flow"><span>Исходник</span><b>→</b><span>Проверка</span><b>→</b><span>Профили</span><b>→</b><span>Варианты</span><b>→</b><span>ChangeSet</span></div>
    </section>
  </div>;
}
