# Project State (DO NOT REWRITE)

## Stack
- Next.js (App Router)
- Prisma + PostgreSQL
- Tailwind CSS

## Blog Admin (SOURCE OF TRUTH)
- UI: app/admin/(private)/blog/AdminBlogClient.tsx
- Page wrapper: app/admin/(private)/blog/page.tsx

## Slug logic (STABLE)
- Client slugify: lib/slug.ts
- Server unique slug: lib/uniqueSlug.ts
- API:
  - POST /api/posts
  - PUT /api/posts/[id]

Rules:
- Slug autogenerates from title
- Autogen stops after manual edit (slugTouched)
- Server guarantees uniqueness
- No кириллица in final slug (latin only)

## Blog Public Page
- app/blog/[slug]/page.tsx
- SEO metadata via generateMetadata
- Canonical URL enabled

## Last stable commit
- <PUT_COMMIT_HASH_HERE>

⚠️ Any new changes MUST be layered on top of this state.
