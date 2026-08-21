# QazPost integration

## Current stage

The shop stores QazPost shipment data directly on `Order`:

- `shippingProvider`
- `shippingServiceCode`
- `shippingStatus`
- `shippingExternalId`
- `trackingNumber`
- `shippingPrice`
- `shippingWeightGrams`
- `shipmentLabelUrl`
- `shippingProviderData`
- `shippingUpdatedAt`
- `shippedAt`
- `deliveredAt`

Admin can save a QazPost tracking number and shipment metadata manually. The customer order page then shows the tracking number and links to the official `post.kz` tracking page.

## Open API address lookup

Official QazPost Open API address search is wired through:

`GET /api/qazpost/address-search?q=...`

It proxies to:

`GET https://open.post.kz/npi-integration/api/npi/search?query=...`

The server keeps the Bearer token private.

For `SITE_KEY=procosmetics`, configure in Vercel:

```text
QAZPOST_API_TOKEN_PROCOSMETICS=<Bearer token issued by QazPost>
QAZPOST_API_BASE_URL_PROCOSMETICS=https://open.post.kz
```

Do not expose the token to browser code and do not store it in the repository.

## Shipment creation API

Automatic creation/cancellation of postal shipments should be enabled only after QazPost provides the current B2B/Open API contract for the merchant account. Endpoint names and payloads are intentionally not guessed in code.

Once the contract is available, implement the create/cancel/status calls in `lib/shipping/qazpost.ts` and persist the external shipment id, label URL, service code and provider response in the existing shipping fields.
