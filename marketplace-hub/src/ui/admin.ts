export function renderAdminPage() {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Catalog Hub</title>
  <style>
    :root {
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #172033;
      background: #f4f6f8;
    }
    * { box-sizing: border-box; }
    body { margin: 0; }
    button, input, textarea, select { font: inherit; }
    .shell { min-height: 100vh; display: grid; grid-template-columns: 230px 1fr; }
    .side { background: #172033; color: #fff; padding: 24px 18px; }
    .brand { font-weight: 800; font-size: 20px; letter-spacing: -.02em; }
    .muted { color: #6f7787; }
    .side .muted { color: #aeb7c6; }
    nav { margin-top: 30px; display: grid; gap: 7px; }
    nav a { color: #dce3ee; text-decoration: none; padding: 10px 12px; border-radius: 10px; }
    nav a.active, nav a:hover { background: rgba(255,255,255,.1); color: #fff; }
    main { padding: 28px; max-width: 1400px; width: 100%; }
    h1 { margin: 0; font-size: 28px; }
    h2 { margin: 0 0 14px; font-size: 19px; }
    .top { display:flex; justify-content:space-between; gap:20px; align-items:center; margin-bottom:24px; }
    .badge { display:inline-flex; padding:7px 10px; border-radius:999px; background:#e9f7ee; color:#267645; font-size:13px; font-weight:700; }
    .grid { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap:14px; margin-bottom:20px; }
    .metric, .panel { background:#fff; border:1px solid #e1e5ea; border-radius:16px; box-shadow:0 1px 2px rgba(16,24,40,.04); }
    .metric { padding:18px; }
    .metric b { display:block; font-size:27px; margin-top:5px; }
    .panel { padding:20px; margin-bottom:18px; }
    .two { display:grid; grid-template-columns: 1fr 1fr; gap:18px; }
    .fields { display:grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap:12px; }
    label { display:grid; gap:6px; font-size:13px; font-weight:700; color:#4d5667; }
    input, textarea, select { width:100%; padding:10px 11px; border:1px solid #ccd2db; border-radius:10px; background:#fff; color:#172033; }
    textarea { min-height:130px; resize:vertical; }
    button { border:0; border-radius:10px; padding:10px 14px; background:#172033; color:#fff; font-weight:700; cursor:pointer; }
    button.secondary { background:#eef1f5; color:#172033; }
    .actions { display:flex; gap:10px; flex-wrap:wrap; margin-top:14px; }
    pre { overflow:auto; max-height:380px; background:#101828; color:#e8edf5; padding:14px; border-radius:12px; white-space:pre-wrap; }
    .tabs { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
    .tabs button { background:#eef1f5; color:#344054; }
    .tabs button.active { background:#172033; color:#fff; }
    .tab { display:none; }
    .tab.active { display:block; }
    .hint { font-size:13px; line-height:1.5; color:#6f7787; margin-top:8px; }
    @media (max-width: 900px) {
      .shell { grid-template-columns:1fr; }
      .side { display:none; }
      main { padding:18px; }
      .grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
      .two, .fields { grid-template-columns:1fr; }
    }
  </style>
</head>
<body>
<div class="shell">
  <aside class="side">
    <div class="brand">Catalog Hub</div>
    <div class="muted" style="margin-top:5px;font-size:13px">Marketplace / PIM</div>
    <nav>
      <a class="active" href="#dashboard">Главная</a>
      <a href="#import">Импорт прайса</a>
      <a href="#cards">Карточки</a>
      <a href="#pricing">Цены</a>
      <a href="#export">Экспорт</a>
    </nav>
  </aside>

  <main>
    <div class="top">
      <div>
        <h1>Catalog Hub</h1>
        <div class="muted" style="margin-top:5px">Отдельное управление каталогом ProCosmetics и маркетплейсами</div>
      </div>
      <span class="badge">Без API маркетплейсов</span>
    </div>

    <div class="grid">
      <div class="metric"><span class="muted">Режим</span><b>Offline</b></div>
      <div class="metric"><span class="muted">Импорт</span><b>CSV/XLSX</b></div>
      <div class="metric"><span class="muted">Kaspi</span><b>XML</b></div>
      <div class="metric"><span class="muted">Источник</span><b>Master Card</b></div>
    </div>

    <div class="tabs">
      <button class="active" data-tab="import">Импорт прайса</button>
      <button data-tab="pricing">Расчёт цены</button>
      <button data-tab="card">Проверка карточки</button>
      <button data-tab="xml">Kaspi XML</button>
    </div>

    <section id="tab-import" class="panel tab active">
      <h2>Импорт прайса поставщика</h2>
      <div class="two">
        <div>
          <label>CSV-текст
            <textarea id="csvText" placeholder="Артикул;Название;Бренд;Цена;Остаток"></textarea>
          </label>
          <div class="actions">
            <button id="csvPreview">Проверить CSV</button>
          </div>
          <div class="hint">Для XLSX выберите файл ниже. Данные пока только анализируются и не применяются автоматически.</div>
          <label style="margin-top:14px">XLSX-файл
            <input id="xlsxFile" type="file" accept=".xlsx,.xls" />
          </label>
          <div class="actions">
            <button id="xlsxPreview">Проверить XLSX</button>
          </div>
        </div>

        <div>
          <div class="fields">
            <label>SKU / Артикул<input id="mSku" value="Артикул" /></label>
            <label>Название<input id="mTitle" value="Название" /></label>
            <label>Бренд<input id="mBrand" value="Бренд" /></label>
            <label>Штрихкод<input id="mBarcode" value="Штрихкод" /></label>
            <label>Закупочная цена<input id="mPrice" value="Цена" /></label>
            <label>Остаток<input id="mStock" value="Остаток" /></label>
          </div>
        </div>
      </div>
      <pre id="importResult">Результат проверки появится здесь.</pre>
    </section>

    <section id="tab-pricing" class="panel tab">
      <h2>Расчёт розничной цены</h2>
      <div class="fields">
        <label>Закупочная цена<input id="purchasePrice" type="number" value="7000" /></label>
        <label>Наценка, %<input id="markup" type="number" value="35" /></label>
        <label>Фиксированная надбавка<input id="fixedMarkup" type="number" value="0" /></label>
        <label>Шаг округления<input id="roundingStep" type="number" value="10" /></label>
      </div>
      <div class="actions"><button id="calcPrice">Рассчитать</button></div>
      <pre id="pricingResult">Результат расчёта появится здесь.</pre>
    </section>

    <section id="tab-card" class="panel tab">
      <h2>Master Card</h2>
      <div class="fields">
        <label>SKU<input id="cardSku" value="TEST001" /></label>
        <label>Название<input id="cardTitle" value="Тестовый товар" /></label>
        <label>Бренд<input id="cardBrand" /></label>
        <label>Цена<input id="cardPrice" type="number" value="12990" /></label>
        <label>Остаток<input id="cardStock" type="number" value="7" /></label>
        <label>Категория<input id="cardCategory" /></label>
      </div>
      <label style="margin-top:12px">Описание<textarea id="cardDescription"></textarea></label>
      <div class="actions"><button id="validateCard">Проверить карточку</button></div>
      <pre id="cardResult">Результат проверки появится здесь.</pre>
    </section>

    <section id="tab-xml" class="panel tab">
      <h2>Предпросмотр Kaspi XML</h2>
      <div class="fields">
        <label>Компания<input id="xmlCompany" value="ProCosmetics" /></label>
        <label>Merchant ID<input id="xmlMerchant" value="MERCHANT" /></label>
        <label>SKU<input id="xmlSku" value="TEST001" /></label>
        <label>Модель<input id="xmlModel" value="Тестовый товар" /></label>
        <label>Бренд<input id="xmlBrand" value="Brand" /></label>
        <label>Цена<input id="xmlPrice" type="number" value="12990" /></label>
        <label>Store ID<input id="xmlStore" value="PP1" /></label>
        <label>Остаток<input id="xmlStock" type="number" value="7" /></label>
        <label>Предзаказ, дней<input id="xmlPreorder" type="number" value="0" /></label>
      </div>
      <div class="actions"><button id="buildXml">Сформировать XML</button></div>
      <pre id="xmlResult">XML появится здесь.</pre>
    </section>
  </main>
</div>

<script>
  const tabs = document.querySelectorAll("[data-tab]");
  tabs.forEach((button) => {
    button.addEventListener("click", () => {
      tabs.forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      document.getElementById("tab-" + button.dataset.tab).classList.add("active");
    });
  });

  function mapping() {
    const out = {
      sku: document.getElementById("mSku").value,
      title: document.getElementById("mTitle").value,
    };
    const optional = {
      brand: "mBrand",
      barcode: "mBarcode",
      price: "mPrice",
      stock: "mStock",
    };
    Object.entries(optional).forEach(([key, id]) => {
      const value = document.getElementById(id).value.trim();
      if (value) out[key] = value;
    });
    return out;
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text);
    try { return JSON.parse(text); } catch { return text; }
  }

  function show(id, value) {
    document.getElementById(id).textContent =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }

  document.getElementById("csvPreview").onclick = async () => {
    try {
      const value = await postJson("/v1/offline/import/csv", {
        text: document.getElementById("csvText").value,
        delimiter: ";",
        mapping: mapping(),
      });
      show("importResult", value);
    } catch (error) { show("importResult", String(error)); }
  };

  document.getElementById("xlsxPreview").onclick = async () => {
    const file = document.getElementById("xlsxFile").files[0];
    if (!file) return show("importResult", "Выберите XLSX-файл.");
    const buffer = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]);
    try {
      const value = await postJson("/v1/offline/import/xlsx/preview", {
        base64: btoa(binary),
        mapping: mapping(),
      });
      show("importResult", value);
    } catch (error) { show("importResult", String(error)); }
  };

  document.getElementById("calcPrice").onclick = async () => {
    try {
      const value = await postJson("/v1/offline/pricing/calculate", {
        purchasePrice: Number(document.getElementById("purchasePrice").value),
        rules: [{
          name: "Основное правило",
          priority: 1,
          markupPercent: Number(document.getElementById("markup").value),
          fixedMarkup: Number(document.getElementById("fixedMarkup").value),
          roundingStep: Number(document.getElementById("roundingStep").value),
        }],
      });
      show("pricingResult", value);
    } catch (error) { show("pricingResult", String(error)); }
  };

  document.getElementById("validateCard").onclick = async () => {
    try {
      const value = await postJson("/v1/offline/cards/validate", {
        sku: document.getElementById("cardSku").value,
        title: document.getElementById("cardTitle").value,
        brand: document.getElementById("cardBrand").value || undefined,
        description: document.getElementById("cardDescription").value || undefined,
        categoryKey: document.getElementById("cardCategory").value || undefined,
        price: Number(document.getElementById("cardPrice").value),
        stock: Number(document.getElementById("cardStock").value),
        attributes: {},
        images: [],
      });
      show("cardResult", value);
    } catch (error) { show("cardResult", String(error)); }
  };

  document.getElementById("buildXml").onclick = async () => {
    const preorder = Number(document.getElementById("xmlPreorder").value);
    const availability = {
      available: true,
      storeId: document.getElementById("xmlStore").value,
      stockCount: Number(document.getElementById("xmlStock").value),
    };
    if (preorder > 0) availability.preorderDays = preorder;

    try {
      const value = await postJson("/v1/kaspi/price-feed/preview", {
        company: document.getElementById("xmlCompany").value,
        merchantId: document.getElementById("xmlMerchant").value,
        offers: [{
          sku: document.getElementById("xmlSku").value,
          model: document.getElementById("xmlModel").value,
          brand: document.getElementById("xmlBrand").value,
          price: Number(document.getElementById("xmlPrice").value),
          availabilities: [availability],
        }],
      });
      show("xmlResult", value);
    } catch (error) { show("xmlResult", String(error)); }
  };
</script>
</body>
</html>`;
}
