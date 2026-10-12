-- Internal category dictionary: this is NOT a mapping to external marketplace taxonomies.
CREATE TABLE IF NOT EXISTS public."CatalogCategory" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" text NOT NULL REFERENCES public."Organization"("id") ON DELETE CASCADE,
  "key" text NOT NULL CHECK (char_length(btrim("key")) BETWEEN 2 AND 100),
  "name" text NOT NULL CHECK (char_length(btrim("name")) BETWEEN 2 AND 100),
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "catalog_category_key_unique" UNIQUE ("organizationId","key")
);
CREATE INDEX IF NOT EXISTS "catalog_category_active" ON public."CatalogCategory" ("organizationId","isActive","name");
ALTER TABLE public."CatalogCategory" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CatalogCategory" FROM anon, authenticated;

-- Adopt currently used categories without touching the 112 product records.
INSERT INTO public."CatalogCategory" ("organizationId","key","name")
SELECT DISTINCT "organizationId", btrim("categoryKey"), btrim("categoryKey")
FROM public."Product"
WHERE "categoryKey" IS NOT NULL AND btrim("categoryKey") <> '' AND btrim("categoryKey") <> 'Без категории'
ON CONFLICT ("organizationId","key") DO NOTHING;

-- Additional categories supported by the current product assortment.
INSERT INTO public."CatalogCategory" ("organizationId","key","name")
SELECT o."id", c."key", c."key"
FROM public."Organization" o CROSS JOIN
  (VALUES ('Увлажнение'),('Уход за волосами'),('Пилинги'),('Защита от солнца')) AS c("key")
WHERE o."id" = 'org_procosmetics'
ON CONFLICT ("organizationId","key") DO NOTHING;
