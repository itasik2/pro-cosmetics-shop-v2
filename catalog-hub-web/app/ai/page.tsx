import Link from "next/link";

export default function AiPage() {
  return <div className="page">
    <div className="page-head"><div><h1>Поиск информации и фотографий</h1>
      <p>Откройте товар в каталоге и нажмите «Найти и предложить». Catalog Hub ищет страницу производителя и готовит данные для проверки перед применением.</p></div></div>
    <Link className="button primary" href="/catalog">Открыть каталог →</Link>
  </div>;
}
