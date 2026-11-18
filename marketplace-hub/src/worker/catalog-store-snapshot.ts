import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { z } from "zod";
import { importWorkerBackoff } from "./catalog-import-worker.js";
import { DeliveryError, deliveryHash, limitedDeliveryJson } from "./delivery-contract.js";

const contextId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const nonempty = z.string().min(1).refine(value => value.trim() === value);
const optionalText = z.string().nullable();
const offer = z.object({
  sellerSku: nonempty,
  productId: nonempty,
  internalSku: nonempty,
  masterProductId: optionalText,
  title: z.string(),
  brand: z.string(),
  barcode: optionalText,
  categoryKey: optionalText,
  description: optionalText,
  shortDescription: optionalText,
  application: optionalText,
  ingredients: optionalText,
  images: z.array(z.string()),
  price: z.number().int().positive().safe(),
  availabilities: z.array(z.object({
    storeId: nonempty,
    stockCount: z.number().int().nonnegative().safe(),
    preorderDays: z.number().int().min(1).max(30).optional(),
  })).min(1),
});
const channelExport = z.object({
  schema: z.literal("catalog-hub/channel-export"),
  version: z.literal(1),
  semantics: z.literal("SELECTED_OFFERS"),
  connectionId: contextId,
  mode: z.enum(["SHADOW", "ACTIVE", "PAUSED"]),
  deliveryStatus: z.literal("NOT_PUBLISHED"),
  items: z.array(offer).max(10_000),
});

type SnapshotOptions = {
  baseUrl: string;
  key: string;
  organizationId: string;
  connectionId: string;
  allowLoopbackTest?: boolean;
  signal?: AbortSignal;
  fetchCore?: typeof fetch;
};

function exportUrl(options: SnapshotOptions) {
  let url: URL;
  try {
    url = new URL(options.baseUrl);
  } catch {
    throw new DeliveryError("STORE_SNAPSHOT_URL_INVALID");
  }
  const loopback = options.allowLoopbackTest && url.protocol === "http:" && url.hostname === "127.0.0.1";
  if (url.username || url.password || url.search || url.hash || !(url.protocol === "https:" || loopback)) {
    throw new DeliveryError("STORE_SNAPSHOT_URL_INVALID");
  }
  if (!options.key || !contextId.safeParse(options.organizationId).success || !contextId.safeParse(options.connectionId).success) {
    throw new DeliveryError("STORE_SNAPSHOT_CONFIG_INVALID");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") + "/v1/channels/" + options.connectionId + "/export";
  url.searchParams.set("organizationId", options.organizationId);
  return url;
}

const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function validateStoreSnapshot(input: unknown, connectionId: string) {
  // Zod's default stripping keeps newly added server fields out of the store projection.
  const result = channelExport.safeParse(input);
  if (!result.success || result.data.connectionId !== connectionId) {
    throw new DeliveryError("STORE_SNAPSHOT_INVALID");
  }
  const { items } = result.data;
  const skus = new Set<string>();
  for (const item of items) {
    if (skus.has(item.sellerSku) || new Set(item.availabilities.map(row => row.storeId)).size !== item.availabilities.length) {
      throw new DeliveryError("STORE_SNAPSHOT_DUPLICATE");
    }
    skus.add(item.sellerSku);
    item.availabilities.sort((a, b) => compareText(a.storeId, b.storeId));
  }
  return items.sort((a, b) => compareText(a.sellerSku, b.sellerSku));
}

export async function applyPendingStoreSnapshot(sql: ReturnType<typeof postgres>, options: SnapshotOptions) {
  const url = exportUrl(options);
  const { organizationId: org, connectionId } = options;
  return await sql.begin(async tx => {
    await tx`SET LOCAL statement_timeout = '5s'`;
    await tx`SET LOCAL idle_in_transaction_session_timeout = '20s'`;
    const [lock] = await tx`SELECT pg_try_advisory_xact_lock(
      hashtextextended(${"store-shadow:" + org + ":" + connectionId}, 0)) AS acquired`;
    if (!lock.acquired) return { status: "BUSY" as const, applied: 0 };
    const pending = await tx<{ deliveryId: string }[]>`
      SELECT "deliveryId" FROM public."CatalogDeliveryInbox"
      WHERE "organizationId" = ${org} AND "connectionId" = ${connectionId} AND "state" = 'PENDING'
      ORDER BY "receivedAt", "deliveryId" LIMIT 500`;
    if (!pending.length) return { status: "IDLE" as const, applied: 0 };

    const timeout = AbortSignal.timeout(10_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const response = await (options.fetchCore ?? fetch)(url, {
      cache: "no-store",
      redirect: "error",
      headers: { accept: "application/json", "x-catalog-hub-key": options.key },
      signal,
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new DeliveryError("STORE_SNAPSHOT_HTTP_" + response.status, response.status);
    }
    if (response.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
      await response.body?.cancel();
      throw new DeliveryError("STORE_SNAPSHOT_INVALID");
    }
    const items = validateStoreSnapshot(await limitedDeliveryJson(response, 16 * 1024 * 1024, signal), connectionId);
    signal.throwIfAborted();
    const checksum = deliveryHash(items);
    const [snapshot] = await tx<{ revision: number }[]>`
      INSERT INTO public."CatalogStoreShadowSnapshot" AS snapshot
        ("organizationId", "connectionId", "checksum", "items", "revision", "checkedAt")
      VALUES (${org}, ${connectionId}, ${checksum}, ${tx.json(items)}, 1, clock_timestamp())
      ON CONFLICT ("organizationId", "connectionId") DO UPDATE
      SET "checksum" = EXCLUDED."checksum", "items" = EXCLUDED."items",
          "revision" = snapshot."revision" + (snapshot."checksum" <> EXCLUDED."checksum")::integer,
          "checkedAt" = EXCLUDED."checkedAt"
      RETURNING "revision"`;
    // An invalidation committed during the export stays pending for the next cycle.
    const applied = await tx`UPDATE public."CatalogDeliveryInbox" SET "state" = 'APPLIED'
      WHERE "organizationId" = ${org} AND "connectionId" = ${connectionId} AND "state" = 'PENDING'
        AND "deliveryId" IN ${tx(pending.map(row => row.deliveryId))}`;
    if (applied.count !== pending.length) throw new DeliveryError("STORE_SNAPSHOT_INBOX_CONFLICT", 409);
    return { status: "APPLIED" as const, applied: applied.count, revision: snapshot.revision, count: items.length, checksum };
  });
}

async function main() {
  if (process.env.CATALOG_STORE_SNAPSHOT_ENABLED !== "true") throw new DeliveryError("STORE_SNAPSHOT_DISABLED");
  const receiverDb = process.env.CATALOG_STORE_DATABASE_URL;
  if (!receiverDb) throw new DeliveryError("STORE_SNAPSHOT_DATABASE_REQUIRED");
  const controller = new AbortController();
  const stop = () => controller.abort();
  const options: SnapshotOptions = {
    baseUrl: process.env.CATALOG_HUB_API_URL ?? "",
    key: process.env.CATALOG_STORE_EXPORT_KEY ?? "",
    organizationId: process.env.CATALOG_STORE_ORGANIZATION_ID ?? "",
    connectionId: process.env.CATALOG_STORE_CONNECTION_ID ?? "",
    allowLoopbackTest: process.env.CATALOG_STORE_ALLOW_LOOPBACK_TEST === "true",
    signal: controller.signal,
  };
  exportUrl(options);
  const sql = postgres(receiverDb, { max: 1, connect_timeout: 5 });
  const once = process.argv.includes("--once");
  let failures = 0;
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    while (!controller.signal.aborted) {
      let delay = 15_000;
      try {
        const result = await applyPendingStoreSnapshot(sql, options);
        if (once || result.applied) console.log(JSON.stringify({ event: "store.snapshot", ...result }));
        failures = 0;
        if (result.applied) delay = 1_000;
      } catch (error) {
        if (controller.signal.aborted) break;
        const code = error instanceof DeliveryError ? error.code : "STORE_SNAPSHOT_UNAVAILABLE";
        console.error(JSON.stringify({ event: "store.snapshot_error", code }));
        if (once || ["STORE_SNAPSHOT_HTTP_401", "STORE_SNAPSHOT_HTTP_403"].includes(code)) {
          process.exitCode = 1;
          break;
        }
        delay = Math.max(15_000, importWorkerBackoff(++failures));
      }
      if (once) break;
      await setTimeout(delay, undefined, { signal: controller.signal }).catch(error => {
        if (!controller.signal.aborted) throw error;
      });
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await sql.end({ timeout: 2 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(error => {
    console.error(error instanceof DeliveryError ? error.code : "STORE_SNAPSHOT_WORKER_FAILED");
    process.exitCode = 1;
  });
}
