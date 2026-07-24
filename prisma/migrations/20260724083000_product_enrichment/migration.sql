-- CreateEnum
CREATE TYPE "ProductSourceStatus" AS ENUM ('ACTIVE', 'UNAVAILABLE', 'BLOCKED', 'ERROR');

-- CreateEnum
CREATE TYPE "EnrichmentJobStatus" AS ENUM ('PENDING', 'RUNNING', 'REVIEW', 'APPLIED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "EnrichmentProposalStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED');

-- CreateTable
CREATE TABLE "SupplierSource" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'OFFICIAL_SITE',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "allowSubdomains" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "selectors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSource" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierSourceId" TEXT,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'OFFICIAL_SITE',
    "title" TEXT,
    "contentHash" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastChangedAt" TIMESTAMP(3),
    "status" "ProductSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "httpStatus" INTEGER,
    "rawData" JSONB,
    "extractedData" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceDomain" TEXT,
    "checksum" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrichmentJob" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "EnrichmentJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "sourceUrl" TEXT,
    "error" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnrichmentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductEnrichmentProposal" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sourceId" TEXT,
    "jobId" TEXT,
    "status" "EnrichmentProposalStatus" NOT NULL DEFAULT 'PENDING',
    "sourceUrl" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT,
    "shortDescription" TEXT,
    "description" TEXT,
    "application" TEXT,
    "ingredients" TEXT,
    "images" JSONB,
    "facts" JSONB,
    "warnings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "ProductEnrichmentProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierSource_supplierId_domain_key" ON "SupplierSource"("supplierId", "domain");

-- CreateIndex
CREATE INDEX "SupplierSource_supplierId_isEnabled_priority_idx" ON "SupplierSource"("supplierId", "isEnabled", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSource_productId_url_key" ON "ProductSource"("productId", "url");

-- CreateIndex
CREATE INDEX "ProductSource_supplierSourceId_status_idx" ON "ProductSource"("supplierSourceId", "status");

-- CreateIndex
CREATE INDEX "ProductSource_productId_lastCheckedAt_idx" ON "ProductSource"("productId", "lastCheckedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImage_productId_url_key" ON "ProductImage"("productId", "url");

-- CreateIndex
CREATE INDEX "ProductImage_productId_isPrimary_idx" ON "ProductImage"("productId", "isPrimary");

-- CreateIndex
CREATE INDEX "ProductImage_checksum_idx" ON "ProductImage"("checksum");

-- CreateIndex
CREATE INDEX "EnrichmentJob_status_scheduledAt_idx" ON "EnrichmentJob"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "EnrichmentJob_productId_createdAt_idx" ON "EnrichmentJob"("productId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductEnrichmentProposal_jobId_key" ON "ProductEnrichmentProposal"("jobId");

-- CreateIndex
CREATE INDEX "ProductEnrichmentProposal_productId_status_createdAt_idx" ON "ProductEnrichmentProposal"("productId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ProductEnrichmentProposal_sourceId_idx" ON "ProductEnrichmentProposal"("sourceId");

-- AddForeignKey
ALTER TABLE "SupplierSource" ADD CONSTRAINT "SupplierSource_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSource" ADD CONSTRAINT "ProductSource_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSource" ADD CONSTRAINT "ProductSource_supplierSourceId_fkey" FOREIGN KEY ("supplierSourceId") REFERENCES "SupplierSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrichmentJob" ADD CONSTRAINT "EnrichmentJob_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEnrichmentProposal" ADD CONSTRAINT "ProductEnrichmentProposal_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEnrichmentProposal" ADD CONSTRAINT "ProductEnrichmentProposal_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ProductSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEnrichmentProposal" ADD CONSTRAINT "ProductEnrichmentProposal_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "EnrichmentJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
