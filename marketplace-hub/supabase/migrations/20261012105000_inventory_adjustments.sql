-- Audit-only stock adjustments; no automatic changes to existing inventory.
CREATE TABLE IF NOT EXISTS public."InventoryAdjustment" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "requestId" text NOT NULL,
  "organizationId" text NOT NULL REFERENCES public."Organization"("id") ON DELETE CASCADE,
  "productId" text NOT NULL REFERENCES public."Product"("id") ON DELETE CASCADE,
  "warehouseId" text NOT NULL REFERENCES public."Warehouse"("id") ON DELETE CASCADE,
  "delta" integer NOT NULL CHECK ("delta" <> 0 AND "delta" BETWEEN -100000 AND 100000),
  "beforeOnHand" integer NOT NULL CHECK ("beforeOnHand" >= 0),
  "afterOnHand" integer NOT NULL CHECK ("afterOnHand" >= 0),
  "reservedAtTime" integer NOT NULL CHECK ("reservedAtTime" >= 0),
  "reason" text NOT NULL CHECK (char_length(btrim("reason")) BETWEEN 5 AND 500),
  "actor" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_adjustment_idempotency" UNIQUE ("organizationId","requestId"),
  CONSTRAINT "inventory_adjustment_math" CHECK ("afterOnHand" = "beforeOnHand" + "delta"),
  CONSTRAINT "inventory_adjustment_reservation_guard" CHECK ("afterOnHand" >= "reservedAtTime")
);
CREATE INDEX IF NOT EXISTS "inventory_adjustment_product_history"
  ON public."InventoryAdjustment" ("organizationId","productId","createdAt" DESC);
ALTER TABLE public."InventoryAdjustment" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."InventoryAdjustment" FROM anon,authenticated;
