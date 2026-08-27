# SEO-анализ проекта pro-cosmetics-shop-v2

Актуализировано: 2026-08-27

Подробный текущий аудит SEO, производительности и безопасности находится в:

`docs/SEO_SECURITY_AUDIT_2026-08-27.md`

## Текущий статус

SEO-база проекта развита и в текущем цикле дополнительно усилена:

- единый production base URL и `metadataBase`;
- абсолютные canonical URL на ключевых индексируемых страницах;
- `robots.txt` и динамический `sitemap.xml`;
- чистые канонические внутренние ссылки на карточки товаров;
- `Product` + `Offer` structured data для товаров;
- `BlogPosting`, `Organization`, `WebSite` и `BreadcrumbList` structured data;
- Open Graph и Twitter metadata на основных шаблонах;
- `noindex` для служебных, checkout, admin и гостевых order URL;
- фильтровые URL каталога не конкурируют с каноническими страницами;
- выделенные индексируемые страницы категорий;
- безопасная сериализация JSON-LD.

## Основные оставшиеся задачи

1. Перевести проект с неподдерживаемой ветки Next.js 14 на поддерживаемую security-ветку (минимум 15.5.24+ на дату аудита) отдельным регрессионно проверяемым изменением.
2. После деплоя проверить Product/Merchant Listing и BlogPosting в Google Rich Results и Search Console.
3. Подключить распределённый rate limiting для serverless production.
4. Усилить защиту от конкурентного списания остатков в checkout.
5. После стабилизации Halyk/аналитики перейти к nonce-based CSP с явным `script-src`/`connect-src`.
6. Опираться на production Core Web Vitals перед более агрессивной оптимизацией рендера и изображений.
