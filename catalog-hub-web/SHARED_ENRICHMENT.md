# Shared product search with ProCosmetics

Catalog Hub sends the current product's identity to ProCosmetics server-side.
ProCosmetics reuses its source discovery, HTML extraction, match scoring and
description generation. It returns a draft without changing either catalog.
The operator edits/selects missing fields and optionally one image in the
Catalog Hub card. Saving creates a Catalog Hub changeset for review.

## Preview setup

1. Deploy this branch in both Vercel projects. Use the actual ProCosmetics
   preview hostname when connecting a Catalog Hub preview.
2. Generate a new random secret of at least 32 characters. Add it as a
   **server-only** `CATALOG_HUB_SHARED_ENRICHMENT_TOKEN` in both projects'
   Preview environment. Never put it in `NEXT_PUBLIC_*` or Git.
3. In Catalog Hub Web Preview set
   `PRO_COSMETICS_SHARED_ENRICHMENT_URL=https://<procosmetics-preview-host>`.
   In ProCosmetics Preview, ensure `OPENAI_API_KEY` is present for automatic
   search. A direct product URL can be analyzed without it.
4. Redeploy both projects after changing environment variables. The browser
   must be signed into Catalog Hub, but receives neither secret.
5. Open a product with missing text or photos, start the search, check the
   source URL, SKU and package size, edit/select fields, then open the new
   changeset. No prices or stock are sent to the shared service.

When a secret or URL is missing, the product card reports that search is not
connected. The legacy separate AI queue is still available in installations
using `CATALOG_HUB_AI_API_URL` without the shared-search URL.
