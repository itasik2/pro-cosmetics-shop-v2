-- CreateEnum
CREATE TYPE "PriceImportStatus" AS ENUM ('UPLOADED', 'PARSING', 'REVIEW', 'APPLIED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportRowAction" AS ENUM ('CREATE', 'UPDATE', 'SKIP', 'ERROR', 'MANUAL_REVIEW');

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "siteUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Product"
ADD COLUMN "supplierId" TEXT,
ADD COLUMN "supplierSku" TEXT,
ADD COLUMN "barcode" TEXT,
ADD COLUMN "sourcePrice" INTEGER,
ADD COLUMN "volumeValue" INTEGER,
ADD COLUMN "volumeUnit" TEXT,
ADD COLUMN "productLineCode" TEXT,
ADD COLUMN "productLineName" TEXT,
ADD COLUMN "priceListDate" TIMESTAMP(3),
ADD COLUMN "lastImportedAt" TIMESTAMP(3),
ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "enrichmentStatus" TEXT NOT NULL DEFAULT 'READY',
ADD COLUMN "sourceUrl" TEXT,
ADD COLUMN "descriptionSourceUrl" TEXT,
ADD COLUMN "imageSourceUrl" TEXT;

-- CreateTable
CREATE TABLE "PriceImport" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "sourceDate" TIMESTAMP(3),
    "status" "PriceImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "priceMode" TEXT NOT NULL DEFAULT 'PRICE_AS_IS',
    "markupPercent" INTEGER NOT NULL DEFAULT 0,
    "roundingStep" INTEGER NOT NULL DEFAULT 100,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "createdRows" INTEGER NOT NULL DEFAULT 0,
    "updatedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "PriceImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceImportRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "pageNumber" INTEGER,
    "rawData" JSONB NOT NULL,
    "parsedData" JSONB,
    "supplierSku" TEXT,
    "productId" TEXT,
    "action" "ImportRowAction" NOT NULL DEFAULT 'MANUAL_REVIEW',
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPriceHistory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "importId" TEXT,
    "oldPrice" INTEGER,
    "newPrice" INTEGER NOT NULL,
    "sourcePrice" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_slug_key" ON "Supplier"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Product_supplierId_supplierSku_key" ON "Product"("supplierId", "supplierSku");

-- CreateIndex
CREATE UNIQUE INDEX "PriceImport_supplierId_fileHash_key" ON "PriceImport"("supplierId", "fileHash");

-- CreateIndex
CREATE INDEX "PriceImportRow_importId_action_idx" ON "PriceImportRow"("importId", "action");

-- CreateIndex
CREATE INDEX "PriceImportRow_productId_idx" ON "PriceImportRow"("productId");

-- CreateIndex
CREATE INDEX "ProductPriceHistory_productId_createdAt_idx" ON "ProductPriceHistory"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductPriceHistory_importId_idx" ON "ProductPriceHistory"("importId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceImport" ADD CONSTRAINT "PriceImport_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceImportRow" ADD CONSTRAINT "PriceImportRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "PriceImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceImportRow" ADD CONSTRAINT "PriceImportRow_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPriceHistory" ADD CONSTRAINT "ProductPriceHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPriceHistory" ADD CONSTRAINT "ProductPriceHistory_importId_fkey" FOREIGN KEY ("importId") REFERENCES "PriceImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
