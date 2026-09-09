CREATE TABLE "SecurityAuditEvent" (
  "id" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "clientIpHash" TEXT,
  "subjectHash" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SecurityAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SecurityAuditEvent_event_created_idx"
  ON "SecurityAuditEvent"("eventType", "createdAt");

CREATE INDEX "SecurityAuditEvent_outcome_created_idx"
  ON "SecurityAuditEvent"("outcome", "createdAt");
