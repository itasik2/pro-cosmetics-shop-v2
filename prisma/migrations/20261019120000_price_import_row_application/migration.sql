ALTER TABLE "PriceImportRow" ADD COLUMN "appliedAt" TIMESTAMP(3);

UPDATE "PriceImportRow" AS pir
SET "appliedAt" = COALESCE(parent."appliedAt", parent."createdAt")
FROM "PriceImport" AS parent
WHERE pir."importId" = parent."id"
  AND parent."status" = 'APPLIED'
  AND pir."selected" = true
  AND pir."productId" IS NOT NULL
  AND pir."action" IN ('CREATE', 'UPDATE');

CREATE INDEX "PriceImport_supplier_date_idx" ON "PriceImport" ("supplierId", "sourceDate" DESC);
