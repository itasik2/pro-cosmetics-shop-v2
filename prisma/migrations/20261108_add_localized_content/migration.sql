CREATE TABLE "LocalizedContent" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "summary" TEXT,
  "body" TEXT NOT NULL,
  "sourceName" TEXT NOT NULL,
  "sourceSummary" TEXT,
  "sourceHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REVIEW',
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LocalizedContent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LocalizedContent_key_locale_key" ON "LocalizedContent"("key", "locale");
CREATE INDEX "LocalizedContent_locale_status_idx" ON "LocalizedContent"("locale", "status");