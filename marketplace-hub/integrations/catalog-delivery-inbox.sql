-- Install in the receiving application's database, not as a Catalog Core migration.
-- The application processes PENDING invalidations by reading its scoped export.
CREATE TABLE IF NOT EXISTS public."CatalogDeliveryInbox" (
 "organizationId" TEXT NOT NULL,"connectionId" TEXT NOT NULL,"deliveryId" TEXT NOT NULL,
 "eventId" TEXT NOT NULL,"payloadHash" TEXT NOT NULL,"payload" JSONB NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'PENDING',"receivedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY ("organizationId","connectionId","deliveryId"),
 CHECK ("state" IN ('PENDING','APPLIED','ERROR') AND length("payloadHash")=64)
);
CREATE INDEX IF NOT EXISTS "CatalogDeliveryInbox_pending_idx" ON public."CatalogDeliveryInbox" ("organizationId","connectionId","state","receivedAt");
ALTER TABLE public."CatalogDeliveryInbox" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CatalogDeliveryInbox" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public."CatalogDeliveryInbox" FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public."CatalogDeliveryInbox" FROM authenticated; END IF;
END $$;
