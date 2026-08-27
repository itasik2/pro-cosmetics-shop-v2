# SEO, performance and security audit — procosmetics.kz

Date: 2026-08-27

## Executive summary

The storefront already has a solid e-commerce base: canonical product pages, a dynamic sitemap, server-rendered Product structured data, centralized admin authorization, server-side checkout price calculation, rate limiting on several public write/cost-heavy APIs, hashed guest order access tokens, and strict SSRF controls for enrichment fetches.

This audit focuses on issues that can be fixed safely without a framework migration or payment-flow rewrite.

## Changes implemented in this audit

### SEO

- Product cards link directly to the canonical `/shop/<slug>` URL instead of routing crawlers and users through an API redirect.
- Product meta descriptions are normalized to about 160 characters.
- Product pages now expose Product + BreadcrumbList JSON-LD and Twitter metadata.
- Brand pages now expose safer structured data, breadcrumbs and Twitter metadata.
- Blog articles now use absolute canonical/Open Graph URLs, BlogPosting + BreadcrumbList JSON-LD, published/modified dates and Twitter metadata.
- Blog index now uses ISR (`revalidate = 600`) instead of being force-dynamic.
- The public question page now has an explicit canonical URL and social metadata.
- Root metadata now provides consistent Open Graph/Twitter defaults plus Organization and WebSite/SearchAction structured data.
- Sitemap no longer reports static pages as modified on every request.
- Dedicated category URLs (`kremy`, `syvorotki`, `toniki`) were repaired and added to the sitemap.
- Category pages now map transliterated URL slugs to real product terms instead of searching the database for the literal strings `kremy`, `syvorotki`, and `toniki`.

### Security

- Added response headers: `X-Content-Type-Options`, `X-Frame-Options`, HSTS, Referrer-Policy and Permissions-Policy.
- Added a deliberately conservative CSP (`base-uri`, `object-src`, `frame-ancestors`) that improves protection without risking Halyk ePay, Next.js inline runtime scripts or Umami analytics.
- `/admin`, `/checkout` and `/order` now send `X-Robots-Tag: noindex, nofollow, noarchive` and private/no-store cache headers.
- Guest order pages additionally send `Referrer-Policy: no-referrer` so bearer-style order tokens in the URL are not leaked to external payment/social destinations through Referer headers.
- Inline JSON-LD now uses a serializer that escapes `<`, `>`, `&`, U+2028 and U+2029, preventing imported/admin content from terminating the JSON-LD script element.
- Admin private pages use the same email-bound guard as admin APIs.
- Missing/unknown auth roles now default to `user`, not `admin`.
- Credential comparison uses constant-time comparison when lengths match.
- Added Dependabot monitoring for npm and GitHub Actions dependencies.

## Existing strengths confirmed

- Admin APIs use the centralized `requireAdmin()` guard tied to the configured admin email.
- Enrichment HTTP fetching has domain allowlists, protocol/port restrictions, DNS resolution checks, private/link-local IP blocking, redirect revalidation, response size caps, content-type checks and timeouts.
- Public checkout recalculates product prices server-side and validates stock instead of trusting totals from the browser.
- Guest order access tokens are stored as hashes, not plaintext tokens.
- Public cost-heavy/write APIs already use basic per-IP rate limits.
- Enriched product images are copied to Cloudinary rather than remaining dependent on supplier/CDN hotlinks.

## High-priority remaining work

### 1. Upgrade Next.js

Current dependency: `next 14.2.35`.

Next.js 14 is no longer in the official LTS support window. The target should now be at least the latest 15.5.x security release (15.5.24 or newer at the time of this audit), followed by a full regression test of admin, price import, checkout, Halyk ePay, Telegram and cron routes.

This was intentionally not mixed into this audit patch because the App Router API changed between major versions and a rushed major upgrade can break production flows.

Official references:
- https://nextjs.org/support-policy
- https://github.com/vercel/next.js/security/advisories

### 2. Distributed rate limiting

`lib/rateLimit.ts` stores counters in process memory. This is useful as a local guard but not globally consistent across multiple Vercel serverless instances.

Recommended next step: move rate-limit state to Redis/Upstash (or another atomic distributed store) for checkout, stock-alert, AI question, address search, payment-init and other abuse-sensitive endpoints.

### 3. Checkout concurrency / oversell protection

Checkout validates stock and then updates it inside a transaction, but concurrent transactions can still race around the initial stock read, especially for JSON-stored variants.

Recommended next step: use a serializable transaction with bounded retry for serialization conflicts, and use conditional atomic updates where possible. This is a business-integrity issue rather than an SEO issue.

### 4. Full nonce-based CSP

The CSP added in this audit intentionally protects `base-uri`, embedded objects and framing only. A strict `script-src`/`connect-src` policy needs explicit testing with:

- Next.js runtime scripts,
- Halyk ePay scripts/API,
- Umami,
- Cloudinary,
- Telegram/WhatsApp/external links.

Do not switch to a restrictive script CSP without a tested nonce strategy because payment flows are more valuable than a security header that accidentally blocks them.

## SEO follow-up

- Validate Product/Merchant Listing and BlogPosting markup in Google Rich Results after deployment.
- Submit/re-submit `/sitemap.xml` in Google Search Console and Yandex Webmaster after the template changes.
- Monitor canonical coverage, indexed category pages, Merchant listings and Product snippets.
- Consider product variant structured data once variant identity/URLs are intentionally designed for search.
- Add merchant return/shipping policy structured data after the business rules are finalized.
- Measure real Core Web Vitals before changing the homepage rendering strategy; its expensive database reads are already cached even though the route itself remains dynamic.

## Performance notes

- Blog listing is now cached for 10 minutes.
- Home-page brand/product queries already use `unstable_cache` with 5–30 minute windows, so database pressure is partially controlled.
- Enriched product images are normalized through Cloudinary with a 1200px limit and automatic format/quality.
- A future performance pass should be based on production Core Web Vitals/Lighthouse data rather than replacing every `<img>` with `next/image` blindly, particularly while Next.js itself is due for a security upgrade.
