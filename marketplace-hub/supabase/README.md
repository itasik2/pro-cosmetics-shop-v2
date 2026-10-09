# Catalog Hub on Supabase

The pilot Catalog Hub backend is deployed as a Supabase Edge Function while
Railway is unavailable on the current account.

## Project

- Supabase project: `catalog-hub`
- Region: `ap-southeast-1`
- Edge Function: `catalog-hub`
- Organization ID: `org_procosmetics`
- Warehouse ID: `wh_pav_01`
- Warehouse code: `PAV-01`

## API

Public service probes:

- `GET /health`
- `GET /ready`

Protected routes require `X-Catalog-Hub-Key`:

- `GET /v1/catalog/products`
- `POST /v1/catalog/products`
- `GET /v1/catalog/by-sku/:sku`

The plaintext API key is never stored in PostgreSQL. Only SHA-256 is stored in
`CatalogApiKey.keyHash`.

## Access model

All Catalog Hub tables use RLS and `anon` / `authenticated` table
privileges are revoked. The Edge Function connects through
`SUPABASE_DB_URL` and serves as the server-side access layer.

## ProCosmetics pilot

ProCosmetics runs in shadow mode first:

```
CATALOG_HUB_SHADOW_ENABLED=true
CATALOG_HUB_WRITE_ENABLED=false
```

After the comparison dashboard is validated, the initial seed can be run with
dry-run. Real writes are enabled only for the controlled initial migration.

## Source of truth

The Prisma schema in `marketplace-hub/prisma/schema.prisma` remains the
domain model. Supabase migrations applied to the pilot project:

- `20261007112425_catalog_hub_initial_schema`
- `20261007112505_catalog_hub_add_foreign_key_indexes`
- `20261007112716_catalog_hub_internal_api_keys`
