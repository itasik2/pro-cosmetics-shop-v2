ALTER TABLE "Order" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Order_archived_created_idx" ON "Order"("archivedAt", "createdAt");
