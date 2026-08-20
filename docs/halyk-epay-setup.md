# Halyk ePay integration

The store uses the Halyk hosted payment page. Card details are entered on the Halyk ePay side and are never sent to the ProCosmetics server.

## Environment variables

For `SITE_KEY=procosmetics`, scoped variables have priority:

```text
HALYK_EPAY_MODE_PROCOSMETICS=test
HALYK_EPAY_CLIENT_ID_PROCOSMETICS=...
HALYK_EPAY_CLIENT_SECRET_PROCOSMETICS=...
HALYK_EPAY_TERMINAL_ID_PROCOSMETICS=...
```

Recommended separate callback signing key:

```text
HALYK_EPAY_CALLBACK_SECRET_PROCOSMETICS=<random 32+ byte secret>
```

If it is omitted, `ORDER_ACCESS_SECRET` or `NEXTAUTH_SECRET` is used for callback signing.

Optional overrides:

```text
HALYK_EPAY_PUBLIC_URL_PROCOSMETICS=https://www.procosmetics.kz
HALYK_EPAY_OAUTH_URL_PROCOSMETICS=...
HALYK_EPAY_STATUS_URL_PROCOSMETICS=...
HALYK_EPAY_SCRIPT_URL_PROCOSMETICS=...
```

Do not store production ClientSecret values in GitHub.

## Default endpoints

Test:

- OAuth: `https://test-epay-oauth.epayment.kz/oauth2/token`
- Payment JS: `https://test-epay.epayment.kz/payform/payment-api.js`
- Transaction status: `https://test-epay-api.epayment.kz/check-status/payment/transaction/:invoiceId`

Production:

- OAuth: `https://epay-oauth.homebank.kz/oauth2/token`
- Payment JS: `https://epay.homebank.kz/payform/payment-api.js`
- Transaction status: `https://epay-api.homebank.kz/check-status/payment/transaction/:invoiceId`

The values above follow the current Halyk ePay payment-page and transaction-status documentation. Overrides exist because Halyk has historically published more than one test hostname in different documentation sections.

## Flow

1. Customer creates a prepaid order.
2. Manager confirms the order. The existing 24-hour payment window starts.
3. The personal order page shows `Оплатить картой` when Halyk is configured.
4. The server creates a numeric Halyk invoice ID and requests an OAuth payment token.
5. Browser loads Halyk's `payment-api.js` and calls `halyk.pay()` with the short-lived auth object.
6. Halyk sends `postLink` to `/api/payments/halyk/callback`.
7. Callback validates `secret_hash` and requests the authoritative Halyk transaction status.
8. The order becomes `PAID` only when the Halyk status is `CHARGE` and amount/currency match the order.
9. Existing email/Telegram/WhatsApp payment-confirmation notifications are triggered once.
10. If callback delivery is missed, the return route and the `Проверить статус оплаты` button re-check the transaction through Halyk.

Kaspi transfer remains available as a fallback. A manual admin confirmation records `KASPI_MANUAL` as the payment provider, so a later Halyk charge can be detected as a potential duplicate payment.

## Security notes

- `ClientSecret` is server-only.
- The browser receives only the short-lived Halyk auth object intended for `halyk.pay()`.
- `postLink` uses a signed `secret_hash`.
- Browser return links use a separate signed state and do not expose the customer's order-access token to Halyk.
- A browser redirect alone never marks an order paid.
- Successful payment requires a server-side Halyk status of `CHARGE`.
