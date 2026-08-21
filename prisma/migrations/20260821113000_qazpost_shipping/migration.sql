ALTER TABLE "Order"
ADD COLUMN "shippingProvider" TEXT NOT NULL DEFAULT 'QAZPOST',
ADD COLUMN "shippingServiceCode" TEXT,
ADD COLUMN "shippingStatus" TEXT NOT NULL DEFAULT 'NOT_CREATED',
ADD COLUMN "shippingExternalId" TEXT,
ADD COLUMN "trackingNumber" TEXT,
ADD COLUMN "shippingPrice" INTEGER,
ADD COLUMN "shippingWeightGrams" INTEGER,
ADD COLUMN "shipmentLabelUrl" TEXT,
ADD COLUMN "shippingProviderData" JSONB,
ADD COLUMN "shippingUpdatedAt" TIMESTAMP(3),
ADD COLUMN "shippedAt" TIMESTAMP(3),
ADD COLUMN "deliveredAt" TIMESTAMP(3);

CREATE INDEX "Order_shipping_provider_status_idx"
ON "Order"("shippingProvider", "shippingStatus");

CREATE INDEX "Order_tracking_number_idx"
ON "Order"("trackingNumber");
