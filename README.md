# Pro Cosmetics Shop — Next.js eCommerce (Starter)

Минимальный рабочий прототип магазина профессиональной косметики.

## Запуск локально

1. Скопируйте `.env.example` в `.env` и при необходимости поменяйте значения.
2. Установите зависимости:
   ```bash
   npm install
   ```
3. Примените схему БД и засеять данные:
   ```bash
   npm run db:push
   npm run db:seed
   ```
4. Запустите dev-сервер:
   ```bash
   npm run dev
   ```
5. Откройте: http://localhost:3000

### Admin
- Страница: `/admin`
- Вход: через Credentials (см. `.env`: `AUTH_ADMIN_EMAIL`, `AUTH_ADMIN_PASSWORD`).
- Можно создавать/редактировать товары, удалять.

### Stripe
- По умолчанию выключен (нет ключей). Добавьте `STRIPE_SECRET_KEY` и `STRIPE_PUBLIC_KEY` для тестовых платежей.
- Оплата в тенге (kzt).

### Переключение на PostgreSQL
- В `prisma/schema.prisma` замените `provider = "sqlite"` на `provider = "postgresql"` и выставьте `DATABASE_URL` для Postgres.
- Затем: `npm run db:push`.

### Деплой
- Рекомендуется Vercel. Укажите ENV переменные.
- Для корректного SSR укажите `NEXTAUTH_URL` на ваш домен.

### Multi-site (один шаблон → несколько сайтов)
- Поддерживается запуск одного кода для разных витрин через `SITE_KEY`.
- Пример: `SITE_KEY=procosmetics` для procosmetics.kz и `SITE_KEY=fitoapteka` для fitoapteka.kz.
- Для каждого деплоя (например, в Vercel) задайте свои ENV: `SITE_KEY`, `SITE_TITLE`, `SITE_DESCRIPTION`, `NEXT_PUBLIC_SITE_BRAND`, `NEXT_PUBLIC_URL`.
- **Отдельная БД для каждого сайта:** в Vercel-проекте каждого домена задавайте свой `DATABASE_URL` (не делите одну БД между разными сайтами, если хотите полностью изолированный контент/админку).
- **Отдельная админка по доступу:** задавайте уникальные `AUTH_ADMIN_EMAIL` и `AUTH_ADMIN_PASSWORD` для каждого деплоя.
- **Опционально для shared runtime:** можно использовать scoped-переменные вида `AUTH_ADMIN_EMAIL_<SITE_KEY_UPPER>`, `AUTH_ADMIN_PASSWORD_<SITE_KEY_UPPER>`, `ADMIN_EMAIL_<SITE_KEY_UPPER>`, `RESEND_API_KEY_<SITE_KEY_UPPER>`.
- API настроек сайта (`/api/site-settings`) и тема читаются/сохраняются отдельно по `SITE_KEY`, поэтому контент и оформление не смешиваются между сайтами при общей кодовой базе.

### Быстрое обновление `fito-apteka-shop-v2` по этому шаблону
1. Создайте отдельный Vercel-проект и отдельную БД для `fito-apteka-shop-v2`.
2. Установите ENV минимум:
   - `SITE_KEY=fitoapteka`
   - `NEXT_PUBLIC_SITE_BRAND=fitoapteka.kz`
   - `NEXT_PUBLIC_URL=https://fitoapteka.kz`
   - `DATABASE_URL` (своя, отдельная)
   - `AUTH_ADMIN_EMAIL` / `AUTH_ADMIN_PASSWORD` (свои)
3. Выполните миграции Prisma в окружении fito-проекта.
4. Проверьте `/api/site-settings` и админку `/admin` — настройки и доступ должны быть изолированы от procosmetics.

## Что внутри
- Next.js 14 App Router
- Tailwind CSS
- Prisma + SQLite (локально) / PostgreSQL (продакшн)
- NextAuth (Credentials)
- Stripe Checkout (опционально)
- Базовая админ-панель и каталог
