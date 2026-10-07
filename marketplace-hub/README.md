# Marketplace Hub

Универсальное ядро для работы с карточками, офферами и прайсами маркетплейсов.

## Текущий режим: без API

По умолчанию сервис работает полностью локально и не обращается к Kaspi или другим маркетплейсам.

Доступно:

- Master Card товара;
- валидация карточек;
- CSV-прайсы;
- сопоставление колонок поставщика;
- цена и остаток;
- подготовка карточек маркетплейса;
- генерация Kaspi XML;
- остатки по складам;
- preorder;
- разные цены по городам;
- отдельная Prisma/PostgreSQL-модель под будущий SaaS.

Прямой API-коннектор Kaspi оставлен в коде как отдельный экспериментальный модуль,
но он не запускается в обычном режиме и не нужен для текущей работы.

## Запуск

```bash
cd marketplace-hub
cp .env.example .env
npm install
npm run dev
```

Проверка:

```bash
curl http://localhost:4100/health
curl http://localhost:4100/v1/offline/capabilities
```

## Импорт CSV

Сервис принимает исходный CSV и карту колонок.

Пример тела запроса:

```json
{
  "delimiter": ";",
  "text": "Артикул;Название;Бренд;Цена;Остаток\nA001;Крем 50 мл;Brand;12990;7",
  "mapping": {
    "sku": "Артикул",
    "title": "Название",
    "brand": "Бренд",
    "price": "Цена",
    "stock": "Остаток"
  }
}
```

POST:

```
/v1/offline/import/csv
```

Результат нормализуется во внутреннюю Master Card без привязки к конкретной площадке.

## Проверка карточки

```
POST /v1/offline/cards/validate
```

Карточка может содержать SKU, barcode, название, бренд, описание,
категорию, характеристики, фото, закупочную цену, цену продажи и остаток.

## Kaspi XML без API

```
POST /v1/kaspi/price-feed/preview
```

Формируется готовый XML с:

- price;
- stockCount;
- storeId;
- preOrder;
- cityPrices.

XML можно сначала проверить локально, затем использовать как обычный прайс-фид.

## Дальше без API

1. Web-кабинет Marketplace Hub.
2. Таблица Master Cards.
3. Редактор карточки.
4. Импорт XLSX/CSV/XML.
5. Конструктор сопоставления колонок.
6. Категории и характеристики вручную/через шаблоны.
7. Экспорт Kaspi XML.
8. Шаблоны выгрузок для других маркетплейсов.
9. История изменений и версии карточек.
10. Интеграция ProCosmetics как источника каталога.

API маркетплейсов подключается позже как дополнительный транспорт, не меняя ядро.


## Universal Import Engine

Разработка универсального импорта ведётся в отдельной ветке
`feature/catalog-hub-universal-import`.

Поддерживаются:

- CSV / TSV;
- XLS / XLSX;
- JSON;
- XML;
- YAML / YML;
- автоматическое определение формата;
- вложенные коллекции через `collectionPath`;
- вложенные поля через dot-path, например `product.identity.sku`;
- XML-атрибуты через `@attribute`;
- единый результат нормализации перед созданием Master Card.

Основной endpoint:

```
POST /v1/offline/import/preview
```

Пример JSON-каталога:

```json
{
  "catalog": {
    "products": [
      {
        "identity": { "sku": "A001" },
        "name": "Крем 50 мл",
        "commerce": { "price": 12990, "stock": 7 }
      }
    ]
  }
}
```

Настройка:

```json
{
  "format": "json",
  "collectionPath": "catalog.products",
  "mapping": {
    "sku": "identity.sku",
    "title": "name",
    "price": "commerce.price",
    "stock": "commerce.stock"
  }
}
```

PDF, сканированные каталоги и обработка изображений будут отдельным слоем
Document/Media Import, потому что им требуются извлечение страниц, проверка
качества изображений и OCR только как резервный механизм.


## Document / Media Import

Следующий слой развивается в ветке
`feature/catalog-hub-document-media-import`.

Добавлено:

- импорт текстовых PDF-каталогов без OCR;
- определение страниц без текстового слоя;
- флаг `ocrRecommended` для сканированных документов;
- нормализация типовых PDF-колонок в SKU / EAN / название / бренд / цену / остаток;
- анализ JPEG / PNG / WebP / AVIF / TIFF;
- проверка разрешения и пропорций;
- Media Studio с отдельными производными версиями изображения;
- профили:
  - master;
  - storefront;
  - marketplace;
  - thumbnail;
- оригинал изображения не перезаписывается;
- Prisma-модели для исходных медиа, производных вариантов и документ-импортов.

Основные endpoints:

```
POST /v1/offline/import/pdf/preview
POST /v1/offline/media/analyze
POST /v1/offline/media/transform
GET  /v1/offline/media/presets
```

OCR намеренно не запускается автоматически. Если PDF или изображение не содержит
доступного текстового слоя, система только помечает его для отдельной очереди
распознавания и ручной проверки.


## Catalog AI Enrichment

Ветка:
`feature/catalog-hub-ai-enrichment`.

Catalog AI создаёт только предложение изменений и не публикует карточку автоматически.

Поддерживается:

- безопасная загрузка HTML только с разрешённых доменов;
- защита от SSRF и приватных IP;
- извлечение JSON-LD, title, description, SKU, brand, цены и изображений;
- сопоставление по SKU / бренду / названию / объёму;
- поиск официальной карточки через OpenAI Responses API + web search при наличии ключа;
- опциональный поиск у внешнего проверяемого дистрибьютора;
- генерация черновика описания только из извлечённых фактов;
- fallback без OpenAI: извлечение и проверка явного URL;
- решения AUTO_APPLY_TEXT / REVIEW / DISCARD;
- изображения всегда остаются кандидатами на ручную проверку;
- отдельный endpoint загрузки выбранного изображения и прогонки через Media Studio;
- опциональная Cloudinary-нормализация: удаление фона, trim, центрирование на холсте;
- оригинал изображения не заменяется.

Endpoints:

```
GET  /v1/offline/ai/status
POST /v1/offline/ai/enrich
POST /v1/offline/ai/image-preview

GET  /v1/offline/media/cloud-status
POST /v1/offline/media/background-normalize
```

Без `OPENAI_API_KEY` AI-поиск не выполняется, но явный разрешённый URL
можно анализировать обычным extractor/matcher.

Применение предложения к Master Card будет отдельной операцией после сохранения
предложений в БД и проверки diff.
