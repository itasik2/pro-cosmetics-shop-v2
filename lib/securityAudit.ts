import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

function digest(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  return createHash("sha256").update(normalized).digest("hex");
}

export async function recordSecurityAudit(args: {
  eventType: string;
  outcome: "SUCCESS" | "DENIED" | "ERROR";
  clientIp?: string | null;
  subject?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const eventType = String(args.eventType || "unknown").slice(0, 80);
  const outcome = args.outcome;
  const clientIpHash = digest(args.clientIp);
  const subjectHash = digest(args.subject);
  const metadataJson = JSON.stringify(args.metadata || {}).slice(0, 4000);
  const id = randomUUID();
  const createdAt = new Date();

  try {
    await prisma.$executeRaw`
      INSERT INTO "SecurityAuditEvent"
        ("id", "eventType", "outcome", "clientIpHash", "subjectHash", "metadata", "createdAt")
      VALUES
        (${id}, ${eventType}, ${outcome}, ${clientIpHash}, ${subjectHash}, CAST(${metadataJson} AS jsonb), ${createdAt})
    `;
  } catch (error) {
    console.error(
      "SECURITY AUDIT WRITE FAILED:",
      error instanceof Error ? error.message : "unknown_error",
    );
  }
}
