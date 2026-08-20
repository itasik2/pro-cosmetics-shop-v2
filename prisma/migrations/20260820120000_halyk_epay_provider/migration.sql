ALTER TABLE "Order"
  ADD COLUMN "paymentProvider" TEXT,
  ADD COLUMN "paymentExternalId" TEXT,
  ADD COLUMN "paymentTransactionId" TEXT,
  ADD COLUMN "paymentProviderReference" TEXT,
  ADD COLUMN "paymentProviderStatus" TEXT,
  ADD COLUMN "paymentProviderUpdatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Order_paymentExternalId_key"
  ON "Order"("paymentExternalId");

CREATE INDEX "Order_payment_provider_status_idx"
  ON "Order"("paymentProvider", "paymentProviderStatus");
