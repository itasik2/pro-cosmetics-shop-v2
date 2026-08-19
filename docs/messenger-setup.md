# Автоматические уведомления WhatsApp и Telegram

## Telegram

1. Создайте бота через `@BotFather` и получите token и username.
2. В Vercel добавьте переменные окружения:

```text
TELEGRAM_BOT_TOKEN_PROCOSMETICS=<bot token>
TELEGRAM_BOT_USERNAME_PROCOSMETICS=<username без @>
TELEGRAM_WEBHOOK_SECRET_PROCOSMETICS=replace_with_random_webhook_secret
TELEGRAM_LINK_SECRET_PROCOSMETICS=replace_with_long_random_link_secret
```

Для `TELEGRAM_WEBHOOK_SECRET` используйте только `A-Z`, `a-z`, `0-9`, `_` и `-`. `TELEGRAM_LINK_SECRET` нужен для HMAC-подписи ссылки привязки заказа.

3. После production deploy зарегистрируйте webhook:

```bash
curl -sS -X POST \
  "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H 'Content-Type: application/json' \
  -d '{
    "url":"https://procosmetics.kz/api/webhooks/telegram",
    "secret_token":"YOUR_WEBHOOK_SECRET",
    "allowed_updates":["message"]
  }'
```

Покупатель выбирает Telegram при оформлении. После создания заказа на странице успеха появляется кнопка «Подключить Telegram». Она открывает deep link бота с отдельной HMAC-подписью номера заказа. Защищённый token страницы заказа Telegram не передаётся. После нажатия Start webhook сохраняет `chat_id`, и дальнейшие уведомления отправляются автоматически.

## WhatsApp Cloud API

Нужны Meta Business Portfolio, WhatsApp Business Account и зарегистрированный номер WhatsApp Business Platform.

В Vercel добавьте:

```text
WHATSAPP_ACCESS_TOKEN_PROCOSMETICS=<system user access token>
WHATSAPP_PHONE_NUMBER_ID_PROCOSMETICS=<Phone Number ID>
WHATSAPP_GRAPH_VERSION_PROCOSMETICS=<актуальная Graph API version>
WHATSAPP_TEMPLATE_ORDER_UPDATE_PROCOSMETICS=order_update
WHATSAPP_TEMPLATE_LANGUAGE_PROCOSMETICS=ru
```

Для production используйте system user access token с правом `whatsapp_business_messaging`, а не краткоживущий тестовый user token.

### Шаблон `order_update`

Создайте Utility template в WhatsApp Manager и дождитесь одобрения. Тело шаблона должно соответствовать четырём параметрам, которые передаёт приложение:

```text
Здравствуйте, {{1}}! Заказ {{2}}: {{3}} Страница заказа: {{4}}
```

Параметры:

1. имя клиента;
2. номер заказа;
3. текст события: заказ принят, требуется оплата, оплата подтверждена или новый статус;
4. защищённая ссылка на страницу заказа.

Приложение всегда использует template message для исходящих WhatsApp-уведомлений, поэтому не зависит от 24-часового customer service window.

## Какие события отправляются

- заказ создан;
- заказ подтверждён и требуется оплата Kaspi;
- оплата подтверждена;
- статус изменён на сборку, отправку, завершён или отменён;
- автоматическая отмена неоплаченного заказа также отправляет уведомление;
- неуспешные WhatsApp-отправки повторяются ежедневным site-monitor cron до 5 реальных попыток;
- Telegram-отправка ожидает, пока клиент один раз подключит бота.
