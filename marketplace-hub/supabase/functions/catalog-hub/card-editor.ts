import type postgres from "npm:postgres@3.4.7";

type Sql = ReturnType<typeof postgres>;
type Product = {
  id: string;
  organizationId: string;
  sku: string;
  title: string;
  updatedAt: Date | string;
  snapshotVersion: string;
  [key: string]: unknown;
};
const fields = [
  "title", "barcode", "brand", "categoryKey", "shortDescription",
  "description", "application", "ingredients", "purchasePrice",
  "price", "attributes", "images",
] as const;
type Field = typeof fields[number];
const allowed = new Set<string>(fields);
const textFields = new Set<string>([
  "title", "barcode", "brand", "categoryKey", "shortDescription",
  "description", "application", "ingredients",
]);
const risk = (field: Field) =>
  field === "price" || field === "purchasePrice" ? "HIGH" :
  field === "attributes" || field === "images" ? "MEDIUM" : "LOW";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
function version(row: Product) {
  return String(row.snapshotVersion);
}
function card(row: Product) {
  return {
    sku: row.sku,
    title: row.title,
    barcode: row.barcode ?? null,
    brand: row.brand ?? null,
    categoryKey: row.categoryKey ?? null,
    shortDescription: row.shortDescription ?? null,
    description: row.description ?? null,
    application: row.application ?? null,
    ingredients: row.ingredients ?? null,
    purchasePrice: row.purchasePrice ?? null,
    price: row.basePrice ?? null,
    attributes: row.attributes ?? {},
    images: Array.isArray(row.images) ? row.images : [],
    snapshotVersion: version(row),
  };
}
function normalizePatch(input: unknown): Partial<Record<Field, unknown>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("invalid_patch");
  const patch: Partial<Record<Field, unknown>> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!allowed.has(key)) fail("field_not_editable:" + key);
    const field = key as Field;
    let value: unknown;
    if (textFields.has(field)) {
      if (raw !== null && typeof raw !== "string") fail("invalid_text:" + field);
      value = typeof raw === "string" ? raw.trim() : null;
      if (field === "title" && (!value || String(value).length > 500)) fail("invalid_title");
      if (field === "shortDescription" && String(value || "").length > 280) fail("short_description_too_long");
      if (field !== "title" && value === "") value = null;
    } else if (field === "price" || field === "purchasePrice") {
      if (raw === null) value = null;
      else if (typeof raw === "number" && Number.isSafeInteger(raw) &&
        (field === "price" ? raw > 0 : raw >= 0)) value = raw;
      else fail("invalid_price:" + field);
    } else if (field === "images") {
      if (!Array.isArray(raw) || raw.length > 30 ||
        raw.some((url) => typeof url !== "string" || url.length > 2000 ||
          !/^https?:\/\/[^ ]+$/i.test(url))) fail("invalid_images");
      value = raw;
    } else {
      if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
        JSON.stringify(raw).length > 20000) fail("invalid_attributes");
      value = raw;
    }
    patch[field] = value;
  }
  if (!Object.keys(patch).length) fail("changeset_empty");
  return patch;
}
function same(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
async function parseBody(req: Request) {
  if (Number(req.headers.get("content-length") || 0) > 100000) fail("payload_too_large", 413);
  const body = await req.json().catch(() => fail("invalid_json"));
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("invalid_body");
  return body as Record<string, unknown>;
}
function requiredId(value: unknown, field: string): string {
  if (typeof value !== "string" || !value || value.length > 128) fail(field + "_required");
  return value as string;
}
function readJsonObject(value: unknown): Record<string, unknown> {
  // Legacy change sets contain a JSON string scalar instead of an object.
  // Parse only a bounded number of layers; malformed payloads remain blocked.
  let decoded: unknown = value;
  for (let i = 0; i < 2 && typeof decoded === "string"; i++) {
    try {
      decoded = JSON.parse(decoded);
    } catch {
      fail("changeset_payload_invalid", 409);
    }
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    fail("changeset_payload_invalid", 409);
  }
  return decoded as Record<string, unknown>;
}

function currentChanged(before: Record<string, unknown>, row: Product) {
  // A later import or another approval must invalidate this preview.
  return before.snapshotVersion !== version(row) || before.sku !== row.sku;
}

export async function handleCardEditor(req: Request, route: string, url: URL, sql: Sql): Promise<Response | null> {
  const detail = route.match(/^\/v1\/staging\/changesets\/([a-f0-9-]{36})$/i);
  const action = route.match(/^\/v1\/staging\/changesets\/([a-f0-9-]{36})\/(approve|apply|reject)$/i);

  try {
    if (route === "/v1/staging/changesets" && req.method === "POST") {
      const body = await parseBody(req);
      const organizationId = requiredId(body.organizationId, "organizationId");
      const productId = requiredId(body.productId, "productId");
      const proposed = normalizePatch(body.proposed);
      const result = await sql.begin(async (tx) => {
        const products = await tx<Product[]>`SELECT *, "updatedAt"::text AS "snapshotVersion"
          FROM public."Product" WHERE "id" = ${productId}
            AND "organizationId" = ${organizationId} FOR UPDATE`;
        if (!products.length) fail("product_not_found", 404);
        const current = card(products[0]);
        const changed = fields.filter((field) =>
          Object.prototype.hasOwnProperty.call(proposed, field) &&
          !same(current[field], proposed[field]));
        if (!changed.length) fail("changeset_empty");
        const summary = {
          total: changed.length,
          lowRisk: changed.filter((f) => risk(f) === "LOW").length,
          mediumRisk: changed.filter((f) => risk(f) === "MEDIUM").length,
          highRisk: changed.filter((f) => risk(f) === "HIGH").length,
          changedFields: changed,
        };
        const id = crypto.randomUUID();
        await tx`INSERT INTO public."CatalogChangeSet"
          ("id","organizationId","productId","sku","sourceType","sourceRef",
           "status","current","proposed","summary","createdBy","createdAt","updatedAt")
          VALUES (${id},${organizationId},${productId},${current.sku},'MANUAL',
                  'catalog-hub-web','PREVIEW',${tx.json(current)}::jsonb,
                  ${tx.json(proposed)}::jsonb,${tx.json(summary)}::jsonb,
                  'catalog-hub-ui',now(),now())`;
        for (const field of changed) {
          await tx`INSERT INTO public."CatalogFieldChange"
            ("id","changeSetId","field","risk","beforeValue","afterValue",
             "status","createdAt","updatedAt")
            VALUES (${crypto.randomUUID()},${id},${field},${risk(field)},
                    ${tx.json(current[field] ?? null)}::jsonb,
                    ${tx.json(proposed[field] ?? null)}::jsonb,
                    'PROPOSED',now(),now())`;
        }
        return { id, status: "PREVIEW", summary };
      });
      return json(result, 201);
    }

    if (detail && req.method === "GET") {
      const organizationId = requiredId(url.searchParams.get("organizationId"), "organizationId");
      const rows = await sql`SELECT cs.*, json_build_object('id',p."id",'title',p."title",'sku',p."sku") AS "product"
        FROM public."CatalogChangeSet" cs JOIN public."Product" p
          ON p."id" = cs."productId" AND p."organizationId" = cs."organizationId"
        WHERE cs."id" = ${detail[1]} AND cs."organizationId" = ${organizationId} LIMIT 1`;
      if (!rows.length) return json({ error: "changeset_not_found" }, 404);
      const audit = await sql`SELECT "field","risk","status","beforeValue","afterValue"
        FROM public."CatalogFieldChange"
        WHERE "changeSetId" = ${detail[1]} ORDER BY "createdAt" ASC, "field" ASC`;
      return json({ ...rows[0], fields: audit });
    }

    if (action && req.method === "POST") {
      const body = await parseBody(req);
      const organizationId = requiredId(body.organizationId, "organizationId");
      const id = action[1];
      const operation = action[2];
      const result = await sql.begin(async (tx) => {
        const entries = await tx`SELECT * FROM public."CatalogChangeSet"
          WHERE "id" = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
        if (!entries.length) fail("changeset_not_found", 404);
        const cs = entries[0];
        const audit = await tx`SELECT "field","status" FROM public."CatalogFieldChange"
          WHERE "changeSetId" = ${id} ORDER BY "createdAt"`;
        if (operation === "reject") {
          if (cs.status !== "PREVIEW" && cs.status !== "APPROVED") fail("changeset_closed", 409);
          await tx`UPDATE public."CatalogFieldChange" SET "status"='REJECTED',"rejectedAt"=now(),"updatedAt"=now()
            WHERE "changeSetId"=${id} AND "status" IN ('PROPOSED','APPROVED')`;
          await tx`UPDATE public."CatalogChangeSet" SET "status"='REJECTED',"rejectedAt"=now(),
            "rejectedFields"=${tx.json(audit.map((f) => f.field))}::jsonb,"updatedAt"=now()
            WHERE "id"=${id}`;
          return { id, status: "REJECTED" };
        }
        if (operation === "approve") {
          if (cs.status !== "PREVIEW") fail("changeset_not_preview", 409);
          if (!Array.isArray(body.approvedFields) ||
              !body.approvedFields.length ||
              body.approvedFields.some((f) => typeof f !== "string" ||
                !audit.some((a) => a.field === f))) fail("approved_fields_invalid");
          const approved = [...new Set(body.approvedFields as string[])];
          for (const field of approved) {
            await tx`UPDATE public."CatalogFieldChange" SET "status"='APPROVED',
              "approvedBy"='catalog-hub-ui',"approvedAt"=now(),"updatedAt"=now()
              WHERE "changeSetId"=${id} AND "field"=${field}`;
          }
          await tx`UPDATE public."CatalogChangeSet" SET "status"='APPROVED',
            "approvedFields"=${tx.json(approved)}::jsonb,
            "approvedBy"='catalog-hub-ui',"approvedAt"=now(),"updatedAt"=now()
            WHERE "id"=${id}`;
          return { id, status: "APPROVED" };
        }
        if (cs.status !== "APPROVED") fail("changeset_not_approved", 409);
        const approved = audit.filter((f) => f.status === "APPROVED").map((f) => f.field as Field);
        if (!approved.length) fail("approved_fields_empty");
        const products = await tx<Product[]>`SELECT *, "updatedAt"::text AS "snapshotVersion"
          FROM public."Product" WHERE "id" = ${cs.productId}
          AND "organizationId" = ${organizationId} FOR UPDATE`;
        if (!products.length) fail("product_not_found", 404);
        const before = readJsonObject(cs.current);
        if (currentChanged(before, products[0])) fail("changeset_stale", 409);
        const after = { ...before };
        const proposed = readJsonObject(cs.proposed);
        for (const field of approved) after[field] = proposed[field];
        if (!after.title || typeof after.title !== "string") fail("invalid_title");
        await tx`INSERT INTO public."ProductRevision"
          ("id","productId","changeSetId","reason","snapshot","createdBy","createdAt")
          VALUES (${crypto.randomUUID()},${cs.productId},${id},'CHANGESET_APPLY',
            ${tx.json(before)}::jsonb,'catalog-hub-ui',now())`;
        await tx`UPDATE public."Product" SET
          "title"=CASE WHEN ${approved.includes("title")} THEN ${after.title} ELSE "title" END,
          "barcode"=CASE WHEN ${approved.includes("barcode")} THEN ${after.barcode as string|null} ELSE "barcode" END,
          "brand"=CASE WHEN ${approved.includes("brand")} THEN ${after.brand as string|null} ELSE "brand" END,
          "categoryKey"=CASE WHEN ${approved.includes("categoryKey")} THEN ${after.categoryKey as string|null} ELSE "categoryKey" END,
          "shortDescription"=CASE WHEN ${approved.includes("shortDescription")} THEN ${after.shortDescription as string|null} ELSE "shortDescription" END,
          "description"=CASE WHEN ${approved.includes("description")} THEN ${after.description as string|null} ELSE "description" END,
          "application"=CASE WHEN ${approved.includes("application")} THEN ${after.application as string|null} ELSE "application" END,
          "ingredients"=CASE WHEN ${approved.includes("ingredients")} THEN ${after.ingredients as string|null} ELSE "ingredients" END,
          "purchasePrice"=CASE WHEN ${approved.includes("purchasePrice")} THEN ${after.purchasePrice as number|null} ELSE "purchasePrice" END,
          "basePrice"=CASE WHEN ${approved.includes("price")} THEN ${after.price as number|null} ELSE "basePrice" END,
          "attributes"=CASE WHEN ${approved.includes("attributes")} THEN ${tx.json(after.attributes)}::jsonb ELSE "attributes" END,
          "images"=CASE WHEN ${approved.includes("images")} THEN ${tx.json(after.images)}::jsonb ELSE "images" END,
          "updatedAt"=now()
          WHERE "id"=${cs.productId} AND "organizationId"=${organizationId}`;
        for (const field of approved) {
          await tx`UPDATE public."CatalogFieldChange" SET "status"='APPLIED',
            "appliedBy"='catalog-hub-ui',"appliedAt"=now(),"updatedAt"=now()
            WHERE "changeSetId"=${id} AND "field"=${field} AND "status"='APPROVED'`;
        }
        const status = approved.length === audit.length ? "APPLIED" : "PARTIALLY_APPLIED";
        await tx`UPDATE public."CatalogChangeSet" SET "status"=${status}::public."ChangeSetStatus",
          "appliedFields"=${tx.json(approved)}::jsonb,"appliedBy"='catalog-hub-ui',
          "appliedAt"=now(),"updatedAt"=now() WHERE "id"=${id}`;
        return { id, status, productId: cs.productId };
      });
      return json(result);
    }

    return null;
  } catch (error) {
    const err = error as Error & { status?: number };
    if (err.status) return json({ error: err.message }, err.status);
    console.error("catalog_editor_error", err);
    return json({ error: "catalog_editor_failed" }, 500);
  }
}
