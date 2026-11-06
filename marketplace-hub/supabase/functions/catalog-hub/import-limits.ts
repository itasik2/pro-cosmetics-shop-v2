import {type Sql,type Tx} from "./core-store.ts";
import {RequestError} from "./request-context.ts";

export const importLimits = {
  activeRuns:10, activeRows:20_000, activePayloadBytes:64*1024*1024,
  runRows:10_000, runPayloadBytes:32*1024*1024, rowPayloadBytes:60_000,
  chunkRows:100, batchRows:100, batchTimeMs:10_000, stalledAfterSeconds:300,
};
type QueueUsage={activeRuns:number;uploadingRuns:number;queuedRuns:number;runningRuns:number;reservedRows:string;
  pendingRows:string;payloadBytes:string;oldestRunnableAt:Date|null;stalledRuns:number;checkedAt:Date};

export async function importQueueStatus(sql:Sql|Tx,org:string) {
  const [row] = await sql<QueueUsage[]>`SELECT
    count(*) FILTER (WHERE "state" IN ('UPLOADING','QUEUED','RUNNING'))::int AS "activeRuns",
    count(*) FILTER (WHERE "state"='UPLOADING')::int AS "uploadingRuns",
    count(*) FILTER (WHERE "state"='QUEUED')::int AS "queuedRuns",
    count(*) FILTER (WHERE "state"='RUNNING')::int AS "runningRuns",
    COALESCE(sum("expectedRows") FILTER (WHERE "state" IN ('UPLOADING','QUEUED','RUNNING')),0)::text AS "reservedRows",
    COALESCE(sum("expectedRows"-"processedRows") FILTER (WHERE "state" IN ('QUEUED','RUNNING')),0)::text AS "pendingRows",
    COALESCE(sum("payloadBytes") FILTER (WHERE "state" IN ('UPLOADING','QUEUED','RUNNING')),0)::text AS "payloadBytes",
    min("createdAt") FILTER (WHERE "state" IN ('QUEUED','RUNNING')) AS "oldestRunnableAt",
    count(*) FILTER (WHERE "state" IN ('QUEUED','RUNNING') AND "updatedAt"<statement_timestamp()-${importLimits.stalledAfterSeconds}*interval '1 second')::int AS "stalledRuns",
    statement_timestamp() AS "checkedAt"
    FROM public."CatalogImportRun" WHERE "organizationId"=${org} AND "state" IN ('UPLOADING','QUEUED','RUNNING')`;
  const {checkedAt,...usage}=row;
  return {limits:importLimits,usage:{...usage,reservedRows:Number(usage.reservedRows),
    pendingRows:Number(usage.pendingRows),payloadBytes:Number(usage.payloadBytes)},checkedAt};
}

// Advisory quota locks never conflict with FK KEY SHARE locks acquired by a
// processor inserting Products. Take this lock before locking an import run.
export async function lockImportQuota(tx:Tx,org:string) {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"import-quota:"+org},0))`;
}

export async function checkImportCapacity(tx:Tx,org:string,delta:{runs?:number;rows?:number;bytes?:number}) {
  const {usage}=await importQueueStatus(tx,org);
  if(usage.activeRuns+(delta.runs||0)>importLimits.activeRuns)throw new RequestError("import_queue_limit",429);
  if(usage.reservedRows+(delta.rows||0)>importLimits.activeRows)throw new RequestError("import_row_queue_limit",429);
  if(usage.payloadBytes+(delta.bytes||0)>importLimits.activePayloadBytes)throw new RequestError("import_payload_queue_limit",429);
}
