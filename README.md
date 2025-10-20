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

## Что внутри
- Next.js 14 App Router
- Tailwind CSS
- Prisma + SQLite (локально) / PostgreSQL (продакшн)
- NextAuth (Credentials)
- Stripe Checkout (опционально)
- Базовая админ-панель и каталог
