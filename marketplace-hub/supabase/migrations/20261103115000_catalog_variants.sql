-- Existing SKU rows remain the inventory/price/media identities. No data is
-- copied or grouped by this migration; an operator must approve each grouping.
ALTER TABLE public."Product" ADD COLUMN IF NOT EXISTS "masterProductId" TEXT;
CREATE INDEX IF NOT EXISTS "Product_organizationId_masterProductId_idx" ON public."Product"("organizationId","masterProductId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Product"'::regclass AND conname='Product_variant_master_fkey') THEN
    ALTER TABLE public."Product" ADD CONSTRAINT "Product_variant_master_fkey" FOREIGN KEY ("organizationId","masterProductId")
      REFERENCES public."Product"("organizationId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Product"'::regclass AND conname='Product_variant_not_self') THEN
    ALTER TABLE public."Product" ADD CONSTRAINT "Product_variant_not_self" CHECK ("masterProductId" IS DISTINCT FROM "id");
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public."ProductGrouping" (
  "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "masterProductId" TEXT NOT NULL,
  "beforeState" JSONB NOT NULL, "afterState" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "reason" TEXT NOT NULL, "actor" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "undoneAt" TIMESTAMP(3),
  CONSTRAINT "ProductGrouping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductGrouping_master_fkey" FOREIGN KEY ("organizationId","masterProductId") REFERENCES public."Product"("organizationId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductGrouping_status_valid" CHECK ("status" IN ('ACTIVE','UNDONE'))
);
CREATE INDEX IF NOT EXISTS "ProductGrouping_organizationId_masterProductId_createdAt_idx" ON public."ProductGrouping"("organizationId","masterProductId","createdAt");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."ProductGrouping"'::regclass AND conname='ProductGrouping_status_valid') THEN
    ALTER TABLE public."ProductGrouping" ADD CONSTRAINT "ProductGrouping_status_valid" CHECK ("status" IN ('ACTIVE','UNDONE'));
  END IF;
END $$;
ALTER TABLE public."ProductGrouping" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."ProductGrouping" FROM PUBLIC, anon, authenticated;

-- One common description, no fallback to another variant's images or prices.
CREATE OR REPLACE VIEW public."CatalogProductRead" WITH (security_invoker=true) AS
SELECT p."id",
  p."organizationId",
  p."sku",
  p."barcode",
  CASE WHEN m."id" IS NOT NULL THEN m."title" ELSE p."title" END AS "title",
  CASE WHEN m."id" IS NOT NULL THEN m."brand" ELSE p."brand" END AS "brand",
  CASE WHEN m."id" IS NOT NULL THEN m."shortDescription" ELSE p."shortDescription" END AS "shortDescription",
  CASE WHEN m."id" IS NOT NULL THEN m."description" ELSE p."description" END AS "description",
  CASE WHEN m."id" IS NOT NULL THEN m."application" ELSE p."application" END AS "application",
  CASE WHEN m."id" IS NOT NULL THEN m."ingredients" ELSE p."ingredients" END AS "ingredients",
  CASE WHEN m."id" IS NOT NULL THEN m."categoryKey" ELSE p."categoryKey" END AS "categoryKey",
  p."attributes",
  p."images",
  p."purchasePrice",
  p."basePrice",
  p."createdAt",
  p."updatedAt",
  p."masterProductId",
  m."updatedAt" AS "masterUpdatedAt"
FROM public."Product" p
LEFT JOIN public."Product" m ON m."id"=p."masterProductId" AND m."organizationId"=p."organizationId";
REVOKE ALL ON public."CatalogProductRead" FROM PUBLIC, anon, authenticated;

-- Also protect less recent import/AI clients from writing an invisible second
-- shared description into a member SKU. Commercial fields remain independent.
CREATE OR REPLACE FUNCTION public.catalog_variant_shared_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
  IF NEW."masterProductId" IS NOT NULL AND
    ROW(NEW."title", NEW."brand", NEW."shortDescription", NEW."description", NEW."application", NEW."ingredients", NEW."categoryKey") IS DISTINCT FROM
    ROW(OLD."title", OLD."brand", OLD."shortDescription", OLD."description", OLD."application", OLD."ingredients", OLD."categoryKey") THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='variant_shared_fields_readonly';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.catalog_variant_shared_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS catalog_variant_shared_guard ON public."Product";
CREATE TRIGGER catalog_variant_shared_guard BEFORE UPDATE ON public."Product" FOR EACH ROW EXECUTE FUNCTION public.catalog_variant_shared_guard();
