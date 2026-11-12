-- Apply in the receiver database after catalog-delivery-inbox.sql.
-- The storefront does not read this shadow table at checkout.
CREATE TABLE IF NOT EXISTS public."CatalogStoreShadowSnapshot" (
  "organizationId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "checksum" TEXT NOT NULL CHECK ("checksum" ~ '^[a-f0-9]{64}$'),
  "items" JSONB NOT NULL CHECK (jsonb_typeof("items") = 'array' AND jsonb_array_length("items") <= 10000),
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "checkedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("organizationId", "connectionId")
);
ALTER TABLE public."CatalogStoreShadowSnapshot" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CatalogStoreShadowSnapshot" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public."CatalogStoreShadowSnapshot" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public."CatalogStoreShadowSnapshot" FROM authenticated;
  END IF;
END $$;
