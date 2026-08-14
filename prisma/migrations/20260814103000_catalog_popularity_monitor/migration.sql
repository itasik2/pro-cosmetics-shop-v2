ALTER TABLE "Product"
ADD COLUMN "popularityPinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "popularityExcluded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "popularityScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "popularityConfidence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "popularityReason" TEXT,
ADD COLUMN "popularityEvidence" JSONB,
ADD COLUMN "popularityCheckedAt" TIMESTAMP(3);

-- Сохраняем все ранее выбранные вручную популярные товары как закреплённые.
UPDATE "Product"
SET "popularityPinned" = true
WHERE "isPopular" = true;

CREATE INDEX "Product_popularity_rank_idx"
ON "Product"("isPublished", "isPopular", "popularityPinned", "popularityScore");
