-- Apply every pending enrichment proposal with a positive match and usable text.
-- This maintenance migration intentionally does not update product images,
-- image metadata, stock, variants, prices, or publication state.

BEGIN;

-- When several proposals exist for one product, use the newest proposal for
-- the product text and resolve every usable pending proposal below.
WITH "RankedText" AS (
    SELECT
        proposal."productId",
        proposal."sourceUrl",
        BTRIM(
            CONCAT_WS(
                E'\n\n',
                NULLIF(BTRIM(COALESCE(proposal."description", '')), ''),
                CASE
                    WHEN NULLIF(BTRIM(COALESCE(proposal."application", '')), '') IS NOT NULL
                    THEN 'Способ применения' || E'\n' || BTRIM(proposal."application")
                    ELSE NULL
                END,
                CASE
                    WHEN NULLIF(BTRIM(COALESCE(proposal."ingredients", '')), '') IS NOT NULL
                    THEN 'Состав и активные компоненты' || E'\n' || BTRIM(proposal."ingredients")
                    ELSE NULL
                END
            )
        ) AS "composedDescription",
        ROW_NUMBER() OVER (
            PARTITION BY proposal."productId"
            ORDER BY proposal."createdAt" DESC, proposal."id" DESC
        ) AS "position"
    FROM "ProductEnrichmentProposal" AS proposal
    WHERE proposal."status" = 'PENDING'
      AND proposal."confidence" > 0
      AND (
          NULLIF(BTRIM(COALESCE(proposal."description", '')), '') IS NOT NULL
          OR NULLIF(BTRIM(COALESCE(proposal."application", '')), '') IS NOT NULL
          OR NULLIF(BTRIM(COALESCE(proposal."ingredients", '')), '') IS NOT NULL
      )
)
UPDATE "Product" AS product
SET
    "description" = ranked."composedDescription",
    "descriptionSourceUrl" = ranked."sourceUrl",
    "updatedAt" = CURRENT_TIMESTAMP
FROM "RankedText" AS ranked
WHERE ranked."position" = 1
  AND product."id" = ranked."productId";

-- Complete the associated jobs without importing any proposed image.
WITH "ApplicableProposals" AS (
    SELECT proposal."jobId"
    FROM "ProductEnrichmentProposal" AS proposal
    WHERE proposal."status" = 'PENDING'
      AND proposal."confidence" > 0
      AND proposal."jobId" IS NOT NULL
      AND (
          NULLIF(BTRIM(COALESCE(proposal."description", '')), '') IS NOT NULL
          OR NULLIF(BTRIM(COALESCE(proposal."application", '')), '') IS NOT NULL
          OR NULLIF(BTRIM(COALESCE(proposal."ingredients", '')), '') IS NOT NULL
      )
)
UPDATE "EnrichmentJob" AS job
SET
    "status" = 'APPLIED',
    "finishedAt" = CURRENT_TIMESTAMP,
    "error" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "ApplicableProposals" AS applicable
WHERE job."id" = applicable."jobId";

-- Products with a positive-match proposal that has no usable text remain in
-- review; all other affected products become ready for manual editing.
WITH "AffectedProducts" AS (
    SELECT DISTINCT proposal."productId"
    FROM "ProductEnrichmentProposal" AS proposal
    WHERE proposal."status" = 'PENDING'
      AND proposal."confidence" > 0
      AND (
          NULLIF(BTRIM(COALESCE(proposal."description", '')), '') IS NOT NULL
          OR NULLIF(BTRIM(COALESCE(proposal."application", '')), '') IS NOT NULL
          OR NULLIF(BTRIM(COALESCE(proposal."ingredients", '')), '') IS NOT NULL
      )
)
UPDATE "Product" AS product
SET
    "enrichmentStatus" = CASE
        WHEN EXISTS (
            SELECT 1
            FROM "ProductEnrichmentProposal" AS remaining
            WHERE remaining."productId" = product."id"
              AND remaining."status" = 'PENDING'
              AND remaining."confidence" > 0
              AND NULLIF(BTRIM(COALESCE(remaining."description", '')), '') IS NULL
              AND NULLIF(BTRIM(COALESCE(remaining."application", '')), '') IS NULL
              AND NULLIF(BTRIM(COALESCE(remaining."ingredients", '')), '') IS NULL
        ) THEN 'REVIEW'
        ELSE 'READY'
    END,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "AffectedProducts" AS affected
WHERE product."id" = affected."productId";

-- Mark only the proposals whose text was actually applied. Proposals with a
-- 0% match or no usable text remain untouched.
UPDATE "ProductEnrichmentProposal" AS proposal
SET
    "status" = 'APPLIED',
    "appliedAt" = CURRENT_TIMESTAMP,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE proposal."status" = 'PENDING'
  AND proposal."confidence" > 0
  AND (
      NULLIF(BTRIM(COALESCE(proposal."description", '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(proposal."application", '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(proposal."ingredients", '')), '') IS NOT NULL
  );

COMMIT;
