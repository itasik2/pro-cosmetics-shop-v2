CREATE UNIQUE INDEX IF NOT EXISTS "OutboxEvent_organizationId_id_key" ON public."OutboxEvent" ("organizationId","id");
CREATE TABLE IF NOT EXISTS public."ChannelWebhook" (
 "id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"connectionId" TEXT NOT NULL,
 "url" TEXT NOT NULL,"secretRef" TEXT NOT NULL,"topics" JSONB NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'PAUSED',"version" INT NOT NULL DEFAULT 1,"generation" INT NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),"updatedAt" TIMESTAMPTZ(6) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "ChannelWebhook_organizationId_id_key" ON public."ChannelWebhook" ("organizationId","id");
CREATE UNIQUE INDEX IF NOT EXISTS "ChannelWebhook_organizationId_connectionId_key" ON public."ChannelWebhook" ("organizationId","connectionId");
CREATE INDEX IF NOT EXISTS "ChannelWebhook_organizationId_state_idx" ON public."ChannelWebhook" ("organizationId","state");
CREATE TABLE IF NOT EXISTS public."OutboxDelivery" (
 "id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"eventId" TEXT NOT NULL,"webhookId" TEXT NOT NULL,
 "generation" INT NOT NULL,"url" TEXT NOT NULL,"secretRef" TEXT NOT NULL,"payload" JSONB NOT NULL,"status" TEXT NOT NULL DEFAULT 'PENDING',"version" INT NOT NULL DEFAULT 1,
 "attempts" INT NOT NULL DEFAULT 0,"availableAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),"leaseToken" TEXT,"leaseUntil" TIMESTAMPTZ(6),
 "lastError" TEXT,"receipt" JSONB,"createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),"deliveredAt" TIMESTAMPTZ(6)
);
CREATE UNIQUE INDEX IF NOT EXISTS "OutboxDelivery_organizationId_eventId_webhookId_key" ON public."OutboxDelivery" ("organizationId","eventId","webhookId");
CREATE INDEX IF NOT EXISTS "OutboxDelivery_organizationId_status_availableAt_id_idx" ON public."OutboxDelivery" ("organizationId","status","availableAt","id");
CREATE INDEX IF NOT EXISTS "OutboxDelivery_organizationId_webhookId_createdAt_id_idx" ON public."OutboxDelivery" ("organizationId","webhookId","createdAt","id");
CREATE INDEX IF NOT EXISTS "OutboxDelivery_organizationId_createdAt_id_idx" ON public."OutboxDelivery" ("organizationId","createdAt","id");
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."ChannelWebhook"'::regclass AND conname='ChannelWebhook_organizationId_fkey') THEN
  ALTER TABLE public."ChannelWebhook" ADD CONSTRAINT "ChannelWebhook_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."ChannelWebhook"'::regclass AND conname='ChannelWebhook_organizationId_connectionId_fkey') THEN
  ALTER TABLE public."ChannelWebhook" ADD CONSTRAINT "ChannelWebhook_organizationId_connectionId_fkey" FOREIGN KEY ("organizationId","connectionId") REFERENCES public."ChannelConnection"("organizationId","id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."OutboxDelivery"'::regclass AND conname='OutboxDelivery_organizationId_fkey') THEN
  ALTER TABLE public."OutboxDelivery" ADD CONSTRAINT "OutboxDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."OutboxDelivery"'::regclass AND conname='OutboxDelivery_organizationId_eventId_fkey') THEN
  ALTER TABLE public."OutboxDelivery" ADD CONSTRAINT "OutboxDelivery_organizationId_eventId_fkey" FOREIGN KEY ("organizationId","eventId") REFERENCES public."OutboxEvent"("organizationId","id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."OutboxDelivery"'::regclass AND conname='OutboxDelivery_organizationId_webhookId_fkey') THEN
  ALTER TABLE public."OutboxDelivery" ADD CONSTRAINT "OutboxDelivery_organizationId_webhookId_fkey" FOREIGN KEY ("organizationId","webhookId") REFERENCES public."ChannelWebhook"("organizationId","id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."ChannelWebhook"'::regclass AND conname='ChannelWebhook_valid') THEN
  ALTER TABLE public."ChannelWebhook" ADD CONSTRAINT "ChannelWebhook_valid" CHECK ("state" IN ('PAUSED','ACTIVE') AND "version">=1 AND "generation">=1 AND length("url") BETWEEN 1 AND 2048 AND "secretRef"~'^CATALOG_DELIVERY_SECRET_[A-Z0-9_]{1,80}$' AND jsonb_typeof("topics")='array' AND jsonb_array_length("topics") BETWEEN 1 AND 6); END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."OutboxDelivery"'::regclass AND conname='OutboxDelivery_valid') THEN
  ALTER TABLE public."OutboxDelivery" ADD CONSTRAINT "OutboxDelivery_valid" CHECK ("status" IN ('PENDING','PROCESSING','RETRY','DEAD','DELIVERED','CANCELED') AND "attempts" BETWEEN 0 AND 8 AND "version">=1 AND "generation">=1 AND jsonb_typeof("payload")='object' AND octet_length("payload"::text)<=8192
    AND "payload" ?& ARRAY['version','deliveryId','eventId','organizationId','connectionId','generation','type','time','data']
    AND "payload"-ARRAY['version','deliveryId','eventId','organizationId','connectionId','generation','type','time','data']='{}'::jsonb
    AND "payload"->'data'='{"refresh":"channel-export"}'::jsonb
    AND COALESCE("payload"->>'deliveryId'="id" AND "payload"->>'eventId'="eventId" AND "payload"->>'organizationId'="organizationId" AND "payload"->>'generation'="generation"::text AND "payload"->>'version'='1',false)
    AND ("status"<>'PROCESSING' OR ("leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL))); END IF;
END $$;
ALTER TABLE public."ChannelWebhook" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OutboxDelivery" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."ChannelWebhook",public."OutboxDelivery" FROM PUBLIC,anon,authenticated;

-- Every producer (Edge and Node) participates in the same atomic fan-out.
-- Only invalidation metadata is projected; source payloads never leave here.
CREATE OR REPLACE FUNCTION public.catalog_enqueue_deliveries() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE s record; delivery_id text;
BEGIN
 IF NEW."topic" NOT IN ('catalog.product_changed','inventory.changed','channel.offer_changed','channel.mappings_changed','catalog.variants_grouped','catalog.variants_ungrouped','channel.refresh_requested') THEN RETURN NEW; END IF;
 -- Registration waits for earlier source transactions; later sources see the
 -- committed recipient. The initial refresh cannot race past an unseen commit.
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('webhook-config:'||NEW."organizationId",0));
 FOR s IN SELECT w.* FROM public."ChannelWebhook" w JOIN public."ChannelConnection" c
   ON c."organizationId"=w."organizationId" AND c."id"=w."connectionId"
   WHERE w."organizationId"=NEW."organizationId" AND c."adapter"='OWN_STORE' AND c."environment"='TEST'
     AND (w."topics" ? NEW."topic" OR NEW."topic"='channel.refresh_requested')
     AND (
       (NEW."topic" IN ('channel.offer_changed','channel.refresh_requested') AND NEW."payload"->>'connectionId'=w."connectionId") OR
       (NEW."topic"='channel.mappings_changed' AND NEW."payload"->>'id'=w."connectionId") OR
       (NEW."topic"='catalog.product_changed' AND EXISTS (SELECT 1 FROM public."ChannelOffer" o JOIN public."Product" p
         ON p."organizationId"=o."organizationId" AND p."id"=o."productId" WHERE o."organizationId"=w."organizationId" AND o."connectionId"=w."connectionId" AND o."isActive"
         AND (o."productId"=NEW."payload"->>'productId' OR p."masterProductId"=NEW."payload"->>'productId'))) OR
       (NEW."topic"='inventory.changed' AND EXISTS (SELECT 1 FROM public."ChannelOffer" o
         WHERE o."organizationId"=w."organizationId" AND o."connectionId"=w."connectionId" AND o."isActive" AND o."productId"=NEW."payload"->>'productId')) OR
       (NEW."topic" IN ('catalog.variants_grouped','catalog.variants_ungrouped') AND EXISTS (SELECT 1 FROM public."ChannelOffer" o
         WHERE o."organizationId"=w."organizationId" AND o."connectionId"=w."connectionId" AND o."isActive" AND NEW."payload"->'productIds' ? o."productId"))
     ) ORDER BY w."id" FOR SHARE OF w
 LOOP
  delivery_id:=pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."OutboxDelivery" ("id","organizationId","eventId","webhookId","generation","url","secretRef","payload") VALUES
   (delivery_id,NEW."organizationId",NEW."id",s."id",s."generation",s."url",s."secretRef",pg_catalog.jsonb_build_object(
     'version',1,'deliveryId',delivery_id,'eventId',NEW."id",'organizationId',NEW."organizationId",'connectionId',s."connectionId",
     'generation',s."generation",'type',NEW."topic",'time',NEW."createdAt",'data',pg_catalog.jsonb_build_object('refresh','channel-export')))
   ON CONFLICT ("organizationId","eventId","webhookId") DO NOTHING;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.catalog_enqueue_deliveries() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS catalog_delivery_fanout ON public."OutboxEvent";
CREATE TRIGGER catalog_delivery_fanout AFTER INSERT ON public."OutboxEvent" FOR EACH ROW EXECUTE FUNCTION public.catalog_enqueue_deliveries();
