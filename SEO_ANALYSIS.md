# SEO-анализ проекта pro-cosmetics-shop-v2

Дата: 2026-03-12

## Краткий вывод

Проект уже содержит сильную базу для SEO: есть `robots`, `sitemap`, динамические метаданные для ключевых страниц, а также `Product` JSON-LD на карточках товаров. При этом остаётся несколько важных технических улучшений, которые могут заметно повысить индексацию и качество сниппетов.

## Что уже хорошо

1. **Есть индексируемый `robots` и ссылка на `sitemap`.**
2. **Есть динамический `sitemap` для товаров, брендов и постов.**
3. **Для главной, каталога, бренда, карточки товара и статьи есть SEO-метаданные (`title`, `description`, частично `openGraph`, `canonical`).**
4. **На странице товара уже добавлена структурированная разметка `Product` (`application/ld+json`).**

## Критичные замечания (High)

### 1) Нет `metadataBase` в корневом layout

В `app/layout.tsx` задано `title/description`, но не указан `metadataBase`. Без него относительные canonical/OG URL на внутренних страницах могут резолвиться не всегда предсказуемо в разных окружениях.

**Риск:** неконсистентные canonical/OG URL, слабее контроль над дублями.

**Что сделать:**
- добавить `metadataBase: new URL(getPublicBaseUrl())` в `export const metadata`.

### 2) На части страниц используются относительные canonical/OG URL

В `app/blog/[slug]/page.tsx` canonical и `openGraph.url` задаются как относительные пути (`/blog/...`). Для SEO-стандарта предпочтительнее абсолютные URL.

**Риск:** парсеры и внешние краулеры могут интерпретировать URL неоднозначно.

**Что сделать:**
- использовать `getPublicBaseUrl()` и формировать абсолютные URL в canonical/openGraph.

### 3) Неконсистентные переменные окружения для базового домена

В проекте одновременно используются:
- `NEXT_PUBLIC_URL` (через `getPublicBaseUrl()`),
- `NEXT_PUBLIC_SITE_URL` (на главной и в каталоге),
- а также хардкод fallback-доменов.

**Риск:** разные страницы могут отдавать canonical на разные домены в зависимости от окружения.

**Что сделать:**
- унифицировать источник домена: только `getPublicBaseUrl()` во всех `generateMetadata` и sitemap/robots.

## Важные замечания (Medium)

### 4) `robots.ts` возвращает относительный URL sitemap

Сейчас `sitemap: "/sitemap.xml"`.

**Что лучше:**
- отдавать абсолютный URL на sitemap на базе `getPublicBaseUrl()`.

### 5) Слабое покрытие Open Graph / Twitter metadata на ряде страниц

`about`, `contacts`, `blog` index используют только базовые `title/description`.

**Что сделать:**
- добавить `openGraph` и `twitter` блоки минимум для страниц верхнего уровня.

### 6) Статьи блога не размечены как `Article` JSON-LD

На товарах `Product` разметка есть, на статьях structured data отсутствует.

**Что сделать:**
- добавить JSON-LD `Article`/`BlogPosting` (headline, image, datePublished, author, publisher, mainEntityOfPage).

### 7) Индексация filter-URL каталога не контролируется

Каталог имеет query-параметры (`brand`, `sort`, `fav`, `instock`). Canonical частично учитывает `brand`, но не видно явной стратегии для страниц с остальными фильтрами.

**Что сделать:**
- для нефундаментальных фильтров (`sort`, `fav`, `instock`) каноникалить на базовый URL категории/бренда;
- при необходимости добавлять `noindex,follow` для «тонких» фильтровых комбинаций.

## Улучшения второго приоритета (Low)

1. Добавить `FAQPage` schema для FAQ-блока (если есть в контенте).
2. Добавить `Organization`/`WebSite` schema в корневом layout.
3. Проверить уникальность и длину title/description по всем шаблонам.
4. Добавить хлебные крошки (`BreadcrumbList` schema) для карточек товара и статей.
5. Вынести SEO-конфиги в единый helper (например `lib/seo.ts`) для консистентности.

## Приоритетный план внедрения (рекомендуемый)

### Этап 1 (быстрые wins, 1–2 часа)
- Добавить `metadataBase` в `app/layout.tsx`.
- Перевести relative canonical/OG URL на absolute в `app/blog/[slug]/page.tsx`.
- Унифицировать base URL: использовать только `getPublicBaseUrl()`.

### Этап 2 (2–4 часа)
- Расширить OG/Twitter для всех top-level страниц.
- Нормализовать canonical-стратегию для каталога с фильтрами.
- Сделать абсолютный sitemap URL в `robots.ts`.

### Этап 3 (4–8 часов)
- Добавить `Article` JSON-LD для блога.
- Добавить `Organization`/`WebSite` + breadcrumbs schema.
- Прогнать Lighthouse и Search Console validation после деплоя.

## Мини-чеклист проверки после внедрения

- [ ] У всех индексируемых страниц есть уникальные `title` и `description`.
- [ ] Все canonical URL абсолютные и указывают на один production-домен.
- [ ] OG и Twitter заполнены на ключевых страницах.
- [ ] `sitemap.xml` содержит только канонические URL.
- [ ] `robots.txt` содержит абсолютную ссылку на sitemap.
- [ ] JSON-LD проходит проверку в Rich Results Test.
