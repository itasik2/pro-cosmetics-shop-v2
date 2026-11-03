-- Additive, rerunnable migration. No catalog, price or physical stock backfill.
-- AlterTable
ALTER TABLE "Inventory" ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CatalogApiKey" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "organizationId" TEXT,
ADD COLUMN IF NOT EXISTS "scopes" JSONB;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ChannelConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'TEST',
    "mode" TEXT NOT NULL DEFAULT 'SHADOW',
    "secretRef" TEXT,
    "settings" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ChannelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ChannelOffer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sellerSku" TEXT NOT NULL,
    "price" INTEGER,
    "channelBuffer" INTEGER NOT NULL DEFAULT 0,
    "preorderDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ChannelOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ChannelWarehouseMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,

    CONSTRAINT "ChannelWarehouseMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ChannelCategoryMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,

    CONSTRAINT "ChannelCategoryMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CoreOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "itemHash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CoreOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CoreOrderItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "returned" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CoreOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "StockMovement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "deltaOnHand" INTEGER NOT NULL,
    "deltaReserved" INTEGER NOT NULL,
    "beforeOnHand" INTEGER NOT NULL,
    "afterOnHand" INTEGER NOT NULL,
    "beforeReserved" INTEGER NOT NULL,
    "afterReserved" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CoreMutation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoreMutation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "InboxEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OutboxEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMPTZ(6),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMPTZ(6),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ChannelConnection_organizationId_mode_createdAt_idx" ON "ChannelConnection"("organizationId", "mode", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChannelConnection_organizationId_id_key" ON "ChannelConnection"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChannelOffer_organizationId_connectionId_sellerSku_key" ON "ChannelOffer"("organizationId", "connectionId", "sellerSku");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChannelOffer_organizationId_connectionId_productId_key" ON "ChannelOffer"("organizationId", "connectionId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChannelWarehouseMapping_organizationId_connectionId_warehou_key" ON "ChannelWarehouseMapping"("organizationId", "connectionId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChannelWarehouseMapping_organizationId_connectionId_externa_key" ON "ChannelWarehouseMapping"("organizationId", "connectionId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChannelCategoryMapping_organizationId_connectionId_category_key" ON "ChannelCategoryMapping"("organizationId", "connectionId", "categoryKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CoreOrder_organizationId_createdAt_id_idx" ON "CoreOrder"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CoreOrder_organizationId_id_key" ON "CoreOrder"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CoreOrder_organizationId_connectionId_externalOrderId_key" ON "CoreOrder"("organizationId", "connectionId", "externalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CoreOrderItem_organizationId_orderId_productId_warehouseId_key" ON "CoreOrderItem"("organizationId", "orderId", "productId", "warehouseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StockMovement_organizationId_productId_createdAt_id_idx" ON "StockMovement"("organizationId", "productId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "StockMovement_organizationId_operationKey_ordinal_key" ON "StockMovement"("organizationId", "operationKey", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CoreMutation_organizationId_key_key" ON "CoreMutation"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "InboxEvent_organizationId_connectionId_externalEventId_key" ON "InboxEvent"("organizationId", "connectionId", "externalEventId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OutboxEvent_organizationId_status_availableAt_id_idx" ON "OutboxEvent"("organizationId", "status", "availableAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Product_organizationId_id_key" ON "Product"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Warehouse_organizationId_id_key" ON "Warehouse"("organizationId", "id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CatalogApiKey_organizationId_isActive_idx" ON "CatalogApiKey"("organizationId", "isActive");

-- AddForeignKey
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ChannelConnection_organizationId_fkey' AND conrelid='public."ChannelConnection"'::regclass) THEN
    ALTER TABLE "ChannelConnection" ADD CONSTRAINT "ChannelConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $catalog$;

-- AddForeignKey
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ChannelOffer_organizationId_connectionId_fkey' AND conrelid='public."ChannelOffer"'::regclass) THEN
    ALTER TABLE "ChannelOffer" ADD CONSTRAINT "ChannelOffer_organizationId_connectionId_fkey" FOREIGN KEY ("organizationId", "connectionId") REFERENCES "ChannelConnection"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $catalog$;

-- AddForeignKey
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ChannelOffer_organizationId_productId_fkey' AND conrelid='public."ChannelOffer"'::regclass) THEN
    ALTER TABLE "ChannelOffer" ADD CONSTRAINT "ChannelOffer_organizationId_productId_fkey" FOREIGN KEY ("organizationId", "productId") REFERENCES "Product"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $catalog$;

-- AddForeignKey
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ChannelWarehouseMapping_organizationId_connectionId_fkey' AND conrelid='public."ChannelWarehouseMapping"'::regclass) THEN
    ALTER TABLE "ChannelWarehouseMapping" ADD CONSTRAINT "ChannelWarehouseMapping_organizationId_connectionId_fkey" FOREIGN KEY ("organizationId", "connectionId") REFERENCES "ChannelConnection"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $catalog$;

-- AddForeignKey
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ChannelWarehouseMapping_organizationId_warehouseId_fkey' AND conrelid='public."ChannelWarehouseMapping"'::regclass) THEN
    ALTER TABLE "ChannelWarehouseMapping" ADD CONSTRAINT "ChannelWarehouseMapping_organizationId_warehouseId_fkey" FOREIGN KEY ("organizationId", "warehouseId") REFERENCES "Warehouse"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $catalog$;

-- AddForeignKey
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ChannelCategoryMapping_organizationId_connectionId_fkey' AND conrelid='public."ChannelCategoryMapping"'::regclass) THEN
    ALTER TABLE "ChannelCategoryMapping" ADD CONSTRAINT "ChannelCategoryMapping_organizationId_connectionId_fkey" FOREIGN KEY ("organizationId", "connectionId") REFERENCES "ChannelConnection"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $catalog$;

-- AddForeignKey
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CoreOrder_organizationId_fkey' AND conrelid='public."CoreOrder"'::regclass) THEN
    ALTER TABLE "CoreOrder" ADD CONSTRAINT "CoreOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $catalog$;

-- AddForeignKey
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CoreOrder_organizationId_connectionId_fkey' AND conrelid='public."CoreOrder"'::regclass) THEN
    ALTER TABLE "CoreOrder" ADD CONSTRAINT "CoreOrder_organizationId_connectionId_fkey" FOREIGN KEY ("organizationId", "connectionId") REFERENCES "ChannelConnection"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $catalog$;

-- AddForeignKey
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CoreOrderItem_organizationId_orderId_fkey' AND conrelid='public."CoreOrderItem"'::regclass) THEN
    ALTER TABLE "CoreOrderItem" ADD CONSTRAINT "CoreOrderItem_organizationId_orderId_fkey" FOREIGN KEY ("organizationId", "orderId") REFERENCES "CoreOrder"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $catalog$;

-- AddForeignKey
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CoreOrderItem_organizationId_productId_fkey' AND conrelid='public."CoreOrderItem"'::regclass) THEN
    ALTER TABLE "CoreOrderItem" ADD CONSTRAINT "CoreOrderItem_organizationId_productId_fkey" FOREIGN KEY ("organizationId", "productId") REFERENCES "Product"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $catalog$;

-- AddForeignKey
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CoreOrderItem_organizationId_warehouseId_fkey' AND conrelid='public."CoreOrderItem"'::regclass) THEN
    ALTER TABLE "CoreOrderItem" ADD CONSTRAINT "CoreOrderItem_organizationId_warehouseId_fkey" FOREIGN KEY ("organizationId", "warehouseId") REFERENCES "Warehouse"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $catalog$;

-- AddForeignKey
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='StockMovement_organizationId_productId_fkey' AND conrelid='public."StockMovement"'::regclass) THEN
    ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_organizationId_productId_fkey" FOREIGN KEY ("organizationId", "productId") REFERENCES "Product"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $catalog$;

-- AddForeignKey
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='StockMovement_organizationId_warehouseId_fkey' AND conrelid='public."StockMovement"'::regclass) THEN
    ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_organizationId_warehouseId_fkey" FOREIGN KEY ("organizationId", "warehouseId") REFERENCES "Warehouse"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $catalog$;

-- AddForeignKey
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CoreMutation_organizationId_fkey' AND conrelid='public."CoreMutation"'::regclass) THEN
    ALTER TABLE "CoreMutation" ADD CONSTRAINT "CoreMutation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $catalog$;

-- AddForeignKey
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='InboxEvent_organizationId_connectionId_fkey' AND conrelid='public."InboxEvent"'::regclass) THEN
    ALTER TABLE "InboxEvent" ADD CONSTRAINT "InboxEvent_organizationId_connectionId_fkey" FOREIGN KEY ("organizationId", "connectionId") REFERENCES "ChannelConnection"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $catalog$;

-- AddForeignKey
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='OutboxEvent_organizationId_fkey' AND conrelid='public."OutboxEvent"'::regclass) THEN
    ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $catalog$;

-- Existing balances are preserved. New/updated balances must obey the ledger.
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_balance_nonnegative' AND conrelid='public."Inventory"'::regclass) THEN
    ALTER TABLE public."Inventory" ADD CONSTRAINT "inventory_balance_nonnegative"
  CHECK ("onHand">=0 AND "reserved">=0 AND "reserved"<="onHand" AND "safetyStock">=0 AND "revision">=0) NOT VALID;
  END IF;
END $catalog$;
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='stock_movement_math' AND conrelid='public."StockMovement"'::regclass) THEN
    ALTER TABLE public."StockMovement" ADD CONSTRAINT "stock_movement_math" CHECK
  ("afterOnHand"="beforeOnHand"+"deltaOnHand" AND "afterReserved"="beforeReserved"+"deltaReserved"
    AND "beforeOnHand">=0 AND "afterOnHand">=0 AND "beforeReserved">=0 AND "afterReserved">=0
    AND "afterReserved"<="afterOnHand" AND char_length(btrim("reason")) BETWEEN 5 AND 500);
  END IF;
END $catalog$;
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='core_order_item_quantity' AND conrelid='public."CoreOrderItem"'::regclass) THEN
    ALTER TABLE public."CoreOrderItem" ADD CONSTRAINT "core_order_item_quantity"
  CHECK ("quantity">0 AND "quantity"<=100000 AND "returned">=0 AND "returned"<="quantity");
  END IF;
END $catalog$;
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='core_order_status' AND conrelid='public."CoreOrder"'::regclass) THEN
    ALTER TABLE public."CoreOrder" ADD CONSTRAINT "core_order_status"
  CHECK ("status" IN ('RESERVED','CANCELED','SHIPPED','PARTIALLY_RETURNED','RETURNED') AND "version">=1);
  END IF;
END $catalog$;
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='channel_connection_mode' AND conrelid='public."ChannelConnection"'::regclass) THEN
    ALTER TABLE public."ChannelConnection" ADD CONSTRAINT "channel_connection_mode"
  CHECK ("mode" IN ('SHADOW','ACTIVE','PAUSED') AND "environment" IN ('TEST','PRODUCTION') AND "version">=1);
  END IF;
END $catalog$;
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='channel_offer_values' AND conrelid='public."ChannelOffer"'::regclass) THEN
    ALTER TABLE public."ChannelOffer" ADD CONSTRAINT "channel_offer_values"
  CHECK (("price" IS NULL OR "price">0) AND "channelBuffer">=0
    AND ("preorderDays" IS NULL OR "preorderDays" BETWEEN 1 AND 30) AND "version">=1);
  END IF;
END $catalog$;
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='outbox_state' AND conrelid='public."OutboxEvent"'::regclass) THEN
    ALTER TABLE public."OutboxEvent" ADD CONSTRAINT "outbox_state"
  CHECK ("status" IN ('PENDING','PROCESSING','RETRY','DELIVERED','DEAD') AND "attempts" BETWEEN 0 AND 8
    AND ("status"<>'PROCESSING' OR ("leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL)));
  END IF;
END $catalog$;
DO $catalog$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='catalog_key_scopes_array' AND conrelid='public."CatalogApiKey"'::regclass) THEN
    ALTER TABLE public."CatalogApiKey" ADD CONSTRAINT "catalog_key_scopes_array"
  CHECK ("scopes" IS NULL OR jsonb_typeof("scopes")='array');
  END IF;
END $catalog$;

-- The database is accessed by the authenticated backend. No Data API grants.
ALTER TABLE public."ChannelConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ChannelOffer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ChannelWarehouseMapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ChannelCategoryMapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CoreOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CoreOrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StockMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CoreMutation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."InboxEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OutboxEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."ChannelConnection",public."ChannelOffer",public."ChannelWarehouseMapping",
  public."ChannelCategoryMapping",public."CoreOrder",public."CoreOrderItem",public."StockMovement",
  public."CoreMutation",public."InboxEvent",public."OutboxEvent" FROM PUBLIC,anon,authenticated;
