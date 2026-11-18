-- Logical UTF-8 JSONB payload accounting. Historical import rows remain private.
ALTER TABLE public."CatalogImportRun" ADD COLUMN IF NOT EXISTS "payloadBytes" INTEGER NOT NULL DEFAULT 0;
WITH sizes AS (
  SELECT r."organizationId",r."id",COALESCE(sum(octet_length(i."payload"::text)),0)::int AS bytes
  FROM public."CatalogImportRun" r LEFT JOIN public."CatalogImportRow" i
    ON i."organizationId"=r."organizationId" AND i."runId"=r."id"
  GROUP BY r."organizationId",r."id"
)
UPDATE public."CatalogImportRun" r SET "payloadBytes"=s.bytes FROM sizes s
WHERE r."organizationId"=s."organizationId" AND r."id"=s."id" AND r."payloadBytes" IS DISTINCT FROM s.bytes;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."CatalogImportRun"'::regclass AND conname='CatalogImportRun_payload_bytes_valid') THEN
    ALTER TABLE public."CatalogImportRun" ADD CONSTRAINT "CatalogImportRun_payload_bytes_valid" CHECK ("payloadBytes" BETWEEN 0 AND 33554432);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "OutboxEvent_organizationId_createdAt_id_idx" ON public."OutboxEvent" ("organizationId","createdAt","id");
CREATE INDEX IF NOT EXISTS "OutboxEvent_organizationId_status_createdAt_id_idx" ON public."OutboxEvent" ("organizationId","status","createdAt","id");
-- No public grants or stock changes. Oversized old runs require explicit review.
