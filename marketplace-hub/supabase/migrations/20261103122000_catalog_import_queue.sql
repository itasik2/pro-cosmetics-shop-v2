-- Durable approved imports; source rows stay private behind the API.
CREATE TABLE IF NOT EXISTS public."CatalogImportRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "supplierId" TEXT,
    "sourceDate" TEXT,
    "profile" JSONB NOT NULL,
    "expectedRows" INTEGER NOT NULL,
    "uploadedRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'UPLOADING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogImportRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."CatalogImportRow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "expectedUpdatedAt" TEXT,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "result" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogImportRow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CatalogImportRun_organizationId_state_createdAt_idx" ON public."CatalogImportRun"("organizationId", "state", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "CatalogImportRun_organizationId_id_key" ON public."CatalogImportRun"("organizationId", "id");

CREATE INDEX IF NOT EXISTS "CatalogImportRow_organizationId_runId_state_rowNumber_idx" ON public."CatalogImportRow"("organizationId", "runId", "state", "rowNumber");

CREATE UNIQUE INDEX IF NOT EXISTS "CatalogImportRow_organizationId_runId_rowNumber_key" ON public."CatalogImportRow"("organizationId", "runId", "rowNumber");

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CatalogImportRun_organizationId_fkey') THEN ALTER TABLE public."CatalogImportRun" ADD CONSTRAINT "CatalogImportRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CatalogImportRow_organizationId_runId_fkey') THEN ALTER TABLE public."CatalogImportRow" ADD CONSTRAINT "CatalogImportRow_organizationId_runId_fkey" FOREIGN KEY ("organizationId", "runId") REFERENCES public."CatalogImportRun"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."CatalogImportRun"'::regclass AND conname='CatalogImportRun_counts_valid') THEN
  ALTER TABLE public."CatalogImportRun" ADD CONSTRAINT "CatalogImportRun_counts_valid" CHECK ("expectedRows" BETWEEN 1 AND 10000 AND "uploadedRows" BETWEEN 0 AND "expectedRows" AND "processedRows" BETWEEN 0 AND "uploadedRows" AND "failedRows" BETWEEN 0 AND "processedRows"); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."CatalogImportRun"'::regclass AND conname='CatalogImportRun_state_valid') THEN
  ALTER TABLE public."CatalogImportRun" ADD CONSTRAINT "CatalogImportRun_state_valid" CHECK ("state" IN ('UPLOADING','QUEUED','RUNNING','SUCCEEDED','PARTIAL','CANCELED')); END IF; END $$;
ALTER TABLE public."CatalogImportRun" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CatalogImportRun" FROM PUBLIC, anon, authenticated;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."CatalogImportRow"'::regclass AND conname='CatalogImportRow_state_valid') THEN
  ALTER TABLE public."CatalogImportRow" ADD CONSTRAINT "CatalogImportRow_state_valid" CHECK ("state" IN ('PENDING','APPLIED','STAGED','ERROR')); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."CatalogImportRow"'::regclass AND conname='CatalogImportRow_attempts_valid') THEN
  ALTER TABLE public."CatalogImportRow" ADD CONSTRAINT "CatalogImportRow_attempts_valid" CHECK ("attempts" BETWEEN 0 AND 3); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."CatalogImportRow"'::regclass AND conname='CatalogImportRow_action_valid') THEN
  ALTER TABLE public."CatalogImportRow" ADD CONSTRAINT "CatalogImportRow_action_valid" CHECK ("action" IN ('CREATE','STAGE','AUTO_INCREASE')); END IF; END $$;
ALTER TABLE public."CatalogImportRow" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CatalogImportRow" FROM PUBLIC, anon, authenticated;
