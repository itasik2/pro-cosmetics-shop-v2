ALTER TABLE "Product"
ADD COLUMN "shortDescription" TEXT;

WITH "ProductSummary" AS (
  SELECT
    "id",
    REGEXP_REPLACE(
      SPLIT_PART("description", E'\n\n', 1),
      E'\\s+',
      ' ',
      'g'
    ) AS "firstParagraph"
  FROM "Product"
  WHERE NULLIF(BTRIM("description"), '') IS NOT NULL
)
UPDATE "Product" AS "product"
SET "shortDescription" = NULLIF(
  BTRIM(
    COALESCE(
      SUBSTRING("summary"."firstParagraph" FROM '^.*?[.!?]'),
      "summary"."firstParagraph"
    )
  ),
  ''
)
FROM "ProductSummary" AS "summary"
WHERE "summary"."id" = "product"."id";
