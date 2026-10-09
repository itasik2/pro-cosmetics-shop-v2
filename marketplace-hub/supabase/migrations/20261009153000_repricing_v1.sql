-- Catalog Hub: safeguarded competitor repricing. 2026-10-09.
-- In the first release observations are MANUAL only; no direct marketplace publication.
CREATE TABLE IF NOT EXISTS public."ChannelRepricingPolicy" (
 "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "organizationId" text NOT NULL REFERENCES public."Organization"("id") ON DELETE CASCADE,
 "productId" text NOT NULL REFERENCES public."Product"("id") ON DELETE CASCADE,
 "channel" text NOT NULL CHECK ("channel" IN ('STORE','KASPI','OZON','WILDBERRIES')),
 "strategy" text NOT NULL DEFAULT 'UNDERCUT' CHECK ("strategy" IN ('UNDERCUT','MATCH','TARGET')),
 "mode" text NOT NULL DEFAULT 'DRY_RUN' CHECK ("mode" IN ('DRY_RUN','AUTO_PROPOSE')),
 "enabled" boolean NOT NULL DEFAULT false,
 "emergencyStop" boolean NOT NULL DEFAULT true,
 "currentOfferPrice" integer CHECK ("currentOfferPrice" > 0),
 "minPrice" integer NOT NULL CHECK ("minPrice" > 0),
 "maxPrice" integer NOT NULL CHECK ("maxPrice" >= "minPrice"),
 "minMarginPercent" numeric(5,2) NOT NULL DEFAULT 10 CHECK ("minMarginPercent" >= 0 AND "minMarginPercent" < 100),
 "feePercent" numeric(5,2) NOT NULL DEFAULT 10 CHECK ("feePercent" >= 0 AND "feePercent" < 100),
 "shippingCost" integer NOT NULL DEFAULT 0 CHECK ("shippingCost" >= 0),
 "targetProfit" integer NOT NULL DEFAULT 0 CHECK ("targetProfit" >= 0),
 "step" integer NOT NULL DEFAULT 10 CHECK ("step" >= 1),
 "adjustment" integer NOT NULL DEFAULT 10 CHECK ("adjustment" >= 0),
 "maxChangePercent" numeric(5,2) NOT NULL DEFAULT 5 CHECK ("maxChangePercent" > 0 AND "maxChangePercent" <= 100),
 "maxAgeMinutes" integer NOT NULL DEFAULT 60 CHECK ("maxAgeMinutes" BETWEEN 1 AND 10080),
 "cooldownMinutes" integer NOT NULL DEFAULT 60 CHECK ("cooldownMinutes" BETWEEN 0 AND 10080),
 "createdAt" timestamptz NOT NULL DEFAULT now(),
 "updatedAt" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "channel_repricing_unique" UNIQUE ("organizationId","productId","channel"),
 CONSTRAINT "channel_repricing_fees_margin_valid" CHECK ("feePercent" + "minMarginPercent" < 100)
);
CREATE TABLE IF NOT EXISTS public."CompetitorPriceObservation" (
 "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "organizationId" text NOT NULL REFERENCES public."Organization"("id") ON DELETE CASCADE,
 "productId" text NOT NULL REFERENCES public."Product"("id") ON DELETE CASCADE,
 "channel" text NOT NULL CHECK ("channel" IN ('STORE','KASPI','OZON','WILDBERRIES')),
 "seller" text NOT NULL CHECK (char_length("seller") BETWEEN 1 AND 120),
 "price" integer NOT NULL CHECK ("price" BETWEEN 1 AND 1000000000),
 "sourceType" text NOT NULL DEFAULT 'MANUAL' CHECK ("sourceType" IN ('MANUAL','VERIFIED_FEED')),
 "sourceRef" text,
 "observedAt" timestamptz NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public."RepricingDecision" (
 "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "organizationId" text NOT NULL REFERENCES public."Organization"("id") ON DELETE CASCADE,
 "policyId" text NOT NULL REFERENCES public."ChannelRepricingPolicy"("id") ON DELETE CASCADE,
 "productId" text NOT NULL REFERENCES public."Product"("id") ON DELETE CASCADE,
 "channel" text NOT NULL,
 "mode" text NOT NULL,
 "status" text NOT NULL CHECK ("status" IN ('BLOCKED','NO_DATA','NO_CHANGE','SIMULATED','PROPOSED')),
 "reason" text NOT NULL,
 "currentPrice" integer,
 "competitorPrice" integer,
 "candidate" integer,
 "floorPrice" integer,
 "targetPrice" integer,
 "observationIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
 "ruleSnapshot" jsonb NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "competitor_observation_lookup" ON public."CompetitorPriceObservation" ("organizationId","productId","channel","observedAt" DESC);
CREATE INDEX IF NOT EXISTS "repricing_decision_lookup" ON public."RepricingDecision" ("organizationId","productId","channel","createdAt" DESC);
CREATE INDEX IF NOT EXISTS "repricing_policy_active" ON public."ChannelRepricingPolicy" ("organizationId","enabled","mode");
ALTER TABLE public."ChannelRepricingPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CompetitorPriceObservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RepricingDecision" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."ChannelRepricingPolicy" FROM anon, authenticated;
REVOKE ALL ON public."CompetitorPriceObservation" FROM anon, authenticated;
REVOKE ALL ON public."RepricingDecision" FROM anon, authenticated;
