export default function Loading() {
  return (
    <div className="page" role="status" aria-live="polite">
      <div className="loading-heading" />
      <p className="subtle">Загрузка раздела…</p>
      <div className="grid metrics" style={{marginTop:20}}>
        {[0,1,2,3].map(i => <div key={i} className="loading-card" />)}
      </div>
      <div className="loading-panel" />
    </div>
  );
}
