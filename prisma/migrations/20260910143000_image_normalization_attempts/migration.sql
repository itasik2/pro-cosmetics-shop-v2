CREATE TABLE "ImageNormalizationAttempt" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "targetKey" TEXT NOT NULL,
  "sourceUrlHash" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "lastError" TEXT,
  "lastAttemptAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImageNormalizationAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ImageNormalizationAttempt_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ImageNormalizationAttempt_product_target_source_key"
ON "ImageNormalizationAttempt"("productId", "targetKey", "sourceUrlHash");

CREATE INDEX "ImageNormalizationAttempt_status_updated_idx"
ON "ImageNormalizationAttempt"("status", "updatedAt");

CREATE INDEX "ImageNormalizationAttempt_product_idx"
ON "ImageNormalizationAttempt"("productId");
