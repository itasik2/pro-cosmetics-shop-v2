# Catalog Hub isolated local test backend

This is a **development-only** PostgreSQL + Deno HTTP API using Docker Compose.
Both exposed ports bind only to 127.0.0.1. The database starts empty and is
populated with synthetic fixtures by `setup.mjs` — it is **not** a clone of
ProCosmetics production. Never expose these containers publicly.

- DB: `127.0.0.1:55432`, database `catalog_test`.
- API: `http://127.0.0.1:8000`, serving the existing Edge runtime from the
  repository directory (read-only volume mount).
- Web: `http://127.0.0.1:3001` running in another terminal on Ubuntu.
- Locally provisioned random API credential is saved in
  `catalog-hub-local/.test-credentials.json` (ignored by Git, 0600).
- Web configuration is generated in `catalog-hub-web/.env.test.local`
  (ignored by Git, 0600). See LOCAL_UBUNTU.md for the steps to activate it.

Run `npm run testdb:setup` from `catalog-hub-web/`.
Requires Docker Engine with Compose, Node.js, npm, and internet on first
install of Postgres/Deno images. It uses `prisma db push` **against a hardcoded
localhost test database**. It never links to or migrates the real Supabase project.

Do not execute `docker compose down -v` unless you intentionally want to
delete all test records. Run `docker compose down` to stop without data loss.
