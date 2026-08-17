CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'KASPI_TRANSFER');
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PENDING', 'PAID', 'REFUNDED');

ALTER TABLE "Order"
ADD COLUMN "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
ADD COLUMN "paidAt" TIMESTAMP(3),
ADD COLUMN "customerNotificationStatus" TEXT NOT NULL DEFAULT 'SKIPPED',
ADD COLUMN "customerNotificationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "customerNotificationLastError" TEXT,
ADD COLUMN "customerNotificationSentAt" TIMESTAMP(3);

CREATE INDEX "Order_customer_notification_status_created_idx"
ON "Order"("customerNotificationStatus", "createdAt");
