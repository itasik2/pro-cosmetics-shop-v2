# Marketplace Hub

Отдельное ядро для работы с карточками и офферами маркетплейсов.

## Цель первого этапа

- единая Master Card товара;
- адаптеры маркетплейсов;
- матрица реальных возможностей каждого API;
- карточка и оффер хранятся раздельно;
- отдельные склады и остатки;
- очередь синхронизации;
- безопасный read-only Kaspi Inspector.

## Kaspi: подтверждено публичной документацией

Через официальный API доступны категории, характеристики/значения,
JSON Schema импорта карточек, импорт новых товаров, статус импорта,
получение и обработка заказов.

Прямые публично документированные per-offer endpoints для мгновенного
изменения цены, остатка и preorder в этом модуле не предполагаются.
Для них транспорт должен быть отдельным (price feed или иной подтвержденный
механизм), поэтому они отмечены как PRICE_FEED.

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
curl http://localhost:4100/v1/connectors
curl http://localhost:4100/v1/kaspi/health
curl http://localhost:4100/v1/kaspi/categories
curl http://localhost:4100/v1/kaspi/import-schema
curl 'http://localhost:4100/v1/kaspi/orders?state=NEW&page=0&size=20'
```

## Следующий этап

1. Привязать MarketplaceAccount к зашифрованным секретам.
2. Добавить категории и характеристики Kaspi в локальный кэш.
3. Master Card editor + validation.
4. Добавить безопасную публикацию карточек через /products/import.
5. Price Feed generator: price / stock / preorder / warehouses.
6. Sync worker + retry + audit log.
7. Подключить ProCosmetics как первый источник каталога.
