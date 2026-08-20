ALTER TABLE "Order"
ADD COLUMN "telegramPendingChatId" TEXT,
ADD COLUMN "telegramPendingAt" TIMESTAMP(3);

ALTER TABLE "StockAlert"
ADD COLUMN "telegramPendingChatId" TEXT,
ADD COLUMN "telegramPendingAt" TIMESTAMP(3);

CREATE INDEX "Order_telegram_pending_idx"
ON "Order"("telegramPendingChatId", "telegramPendingAt");

CREATE INDEX "StockAlert_telegram_pending_idx"
ON "StockAlert"("telegramPendingChatId", "telegramPendingAt");
