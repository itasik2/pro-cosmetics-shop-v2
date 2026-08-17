ALTER TABLE "Order"
  ADD COLUMN "customerAccessTokenHash" TEXT,
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "paymentDueAt" TIMESTAMP(3),
  ADD COLUMN "paymentReportedAt" TIMESTAMP(3),
  ADD COLUMN "paymentReportedNote" TEXT,
  ADD COLUMN "paymentNotificationStatus" TEXT NOT NULL DEFAULT 'SKIPPED',
  ADD COLUMN "paymentNotificationAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "paymentNotificationLastError" TEXT,
  ADD COLUMN "paymentNotificationSentAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Order_customerAccessTokenHash_key"
  ON "Order"("customerAccessTokenHash");

CREATE INDEX "Order_payment_due_idx"
  ON "Order"("paymentDueAt", "paymentMethod", "paymentStatus");

CREATE INDEX "Order_payment_notification_idx"
  ON "Order"("paymentNotificationStatus", "createdAt");
