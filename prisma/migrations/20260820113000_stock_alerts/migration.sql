CREATE TABLE "StockAlert" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "variantLabel" TEXT,
    "customerName" TEXT,
    "notificationChannel" TEXT NOT NULL,
    "notificationContact" TEXT NOT NULL,
    "telegramChatId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockAlert_status_created_idx" ON "StockAlert"("status", "createdAt");
CREATE INDEX "StockAlert_product_variant_status_idx" ON "StockAlert"("productId", "variantId", "status");
CREATE INDEX "StockAlert_channel_contact_idx" ON "StockAlert"("notificationChannel", "notificationContact");

ALTER TABLE "StockAlert" ADD CONSTRAINT "StockAlert_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
