import Link from "next/link";
export default function ImportPage() {
  return <div className="page">
    <div className="page-head"><div><h1>Импорт</h1><p>Универсальный вход для прайсов и каталогов поставщиков.</p></div></div>
    <section className="panel" style={{marginBottom:14}}>
      <span className="badge warn">Предварительный экран</span>
      <p className="subtle">Загрузка и применение файлов ещё не подключены. Эта страница описывает будущий процесс импорта, а не подтверждает его работоспособность.</p>
      <div className="actions"><Link className="button primary" href="/catalog">Открыть каталог товаров →</Link></div>
    </section>
    <div className="grid metrics">
      <Metric label="XLS/XLSX" value="План" />
      <Metric label="CSV/TSV" value="План" />
      <Metric label="XML/YML/JSON" value="План" />
      <Metric label="PDF" value="План" />
    </div>
    <div className="two-col">
      <section className="panel">
        <h2>Новый импорт</h2>
        <div className="list">
          <div className="list-row"><span>1. Источник</span><strong>Файл / каталог</strong></div>
          <div className="list-row"><span>2. Распознавание</span><strong>Формат + mapping</strong></div>
          <div className="list-row"><span>3. Сопоставление</span><strong>SKU / barcode</strong></div>
          <div className="list-row"><span>4. Результат</span><strong>Diff / ChangeSet</strong></div>
        </div>
      </section>
      <section className="panel">
        <h2>Правило безопасности</h2>
        <p className="subtle">Импорт не должен напрямую перезаписывать существующую карточку. Сначала показываются новые товары, изменения цен, остатков и контента, после чего оператор выбирает, что применить.</p>
        <div className="flow" style={{marginTop:14}}><span>Preview</span><b>→</b><span>Match</span><b>→</b><span>Diff</span><b>→</b><span>Approve</span></div>
      </section>
    </div>
  </div>;
}
function Metric({label,value}:{label:string;value:string}) { return <div className="metric"><div className="metric-label">{label}</div><div className="metric-value">{value}</div></div>; }
