-- Catalog Hub media profiles
-- Non-destructive addition used by the Node AI/media worker.

CREATE TABLE IF NOT EXISTS public."MediaProfile" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "target" TEXT,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'BOUND',
  "format" TEXT NOT NULL DEFAULT 'webp',
  "quality" INTEGER NOT NULL DEFAULT 86,
  "background" TEXT NOT NULL DEFAULT '#ffffff',
  "allowUpscale" BOOLEAN NOT NULL DEFAULT false,
  "removeBackground" BOOLEAN NOT NULL DEFAULT false,
  "trim" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MediaProfile_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES public."Organization"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "MediaProfile_organizationId_code_key"
  ON public."MediaProfile"("organizationId", "code");

CREATE INDEX IF NOT EXISTS "MediaProfile_organizationId_isActive_target_idx"
  ON public."MediaProfile"("organizationId", "isActive", "target");

ALTER TABLE public."MediaProfile" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."MediaProfile" FROM anon;
REVOKE ALL ON TABLE public."MediaProfile" FROM authenticated;
