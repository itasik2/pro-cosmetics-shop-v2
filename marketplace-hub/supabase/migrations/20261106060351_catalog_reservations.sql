-- Standalone reservations share Inventory with order reservations; no stock backfill.
CREATE TABLE IF NOT EXISTS public."Reservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL
);
CREATE TABLE IF NOT EXISTS public."ReservationItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "released" INTEGER NOT NULL DEFAULT 0,
  "shipped" INTEGER NOT NULL DEFAULT 0,
  "returned" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "Reservation_organizationId_id_key" ON public."Reservation" ("organizationId","id");
CREATE UNIQUE INDEX IF NOT EXISTS "Reservation_organizationId_reference_key" ON public."Reservation" ("organizationId","reference");
CREATE INDEX IF NOT EXISTS "Reservation_organizationId_status_createdAt_id_idx" ON public."Reservation" ("organizationId","status","createdAt","id");
CREATE INDEX IF NOT EXISTS "Reservation_organizationId_createdAt_id_idx" ON public."Reservation" ("organizationId","createdAt","id");
CREATE UNIQUE INDEX IF NOT EXISTS "ReservationItem_organizationId_reservationId_productId_ware_key" ON public."ReservationItem" ("organizationId","reservationId","productId","warehouseId");
CREATE INDEX IF NOT EXISTS "ReservationItem_organizationId_productId_warehouseId_idx" ON public."ReservationItem" ("organizationId","productId","warehouseId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Reservation"'::regclass AND conname='Reservation_organizationId_fkey') THEN
    ALTER TABLE public."Reservation" ADD CONSTRAINT "Reservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."ReservationItem"'::regclass AND conname='ReservationItem_organizationId_reservationId_fkey') THEN
    ALTER TABLE public."ReservationItem" ADD CONSTRAINT "ReservationItem_organizationId_reservationId_fkey" FOREIGN KEY ("organizationId","reservationId") REFERENCES public."Reservation"("organizationId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."ReservationItem"'::regclass AND conname='ReservationItem_organizationId_productId_fkey') THEN
    ALTER TABLE public."ReservationItem" ADD CONSTRAINT "ReservationItem_organizationId_productId_fkey" FOREIGN KEY ("organizationId","productId") REFERENCES public."Product"("organizationId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."ReservationItem"'::regclass AND conname='ReservationItem_organizationId_warehouseId_fkey') THEN
    ALTER TABLE public."ReservationItem" ADD CONSTRAINT "ReservationItem_organizationId_warehouseId_fkey" FOREIGN KEY ("organizationId","warehouseId") REFERENCES public."Warehouse"("organizationId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Reservation"'::regclass AND conname='Reservation_state_valid') THEN
    ALTER TABLE public."Reservation" ADD CONSTRAINT "Reservation_state_valid" CHECK ("status" IN ('ACTIVE','RELEASED','FULFILLED','PARTIALLY_RETURNED','RETURNED') AND "version">=1 AND length("reference") BETWEEN 1 AND 128 AND length("reason") BETWEEN 5 AND 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."ReservationItem"'::regclass AND conname='ReservationItem_counts_valid') THEN
    ALTER TABLE public."ReservationItem" ADD CONSTRAINT "ReservationItem_counts_valid" CHECK ("quantity" BETWEEN 1 AND 100000 AND "released">=0 AND "shipped">=0 AND "returned">=0 AND "shipped"<= "quantity"-"released" AND "returned"<= "shipped");
  END IF;
END $$;
ALTER TABLE public."Reservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ReservationItem" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."Reservation", public."ReservationItem" FROM PUBLIC, anon, authenticated;
