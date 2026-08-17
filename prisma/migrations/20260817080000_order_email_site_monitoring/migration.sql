CREATE TABLE "SiteHealthCheck" (
    "id" TEXT NOT NULL,
    "siteKey" TEXT NOT NULL,
    "isHealthy" BOOLEAN NOT NULL,
    "responseTimeMs" INTEGER,
    "checks" JSONB NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteHealthCheck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SiteHealthCheck_site_created_idx"
ON "SiteHealthCheck"("siteKey", "createdAt");

CREATE INDEX "SiteHealthCheck_site_health_created_idx"
ON "SiteHealthCheck"("siteKey", "isHealthy", "createdAt");

ALTER TABLE "Order"
ADD COLUMN "notificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN "notificationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "notificationLastError" TEXT,
ADD COLUMN "notificationSentAt" TIMESTAMP(3);

-- Исторические заказы не отправляем повторно после включения новой системы.
UPDATE "Order"
SET
    "notificationStatus" = 'SENT',
    "notificationSentAt" = "createdAt";

CREATE INDEX "Order_notification_status_created_idx"
ON "Order"("notificationStatus", "createdAt");
