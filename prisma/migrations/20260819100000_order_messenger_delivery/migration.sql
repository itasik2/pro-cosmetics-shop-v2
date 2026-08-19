ALTER TABLE "Order"
  ADD COLUMN "telegramChatId" TEXT,
  ADD COLUMN "messengerNotificationStatus" TEXT NOT NULL DEFAULT 'SKIPPED',
  ADD COLUMN "messengerNotificationAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "messengerNotificationLastError" TEXT,
  ADD COLUMN "messengerNotificationSentAt" TIMESTAMP(3),
  ADD COLUMN "messengerNotificationEvent" TEXT;

CREATE INDEX "Order_messenger_notification_idx"
  ON "Order"("messengerNotificationStatus", "createdAt");
