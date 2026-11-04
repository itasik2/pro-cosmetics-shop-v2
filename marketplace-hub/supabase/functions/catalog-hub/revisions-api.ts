import { textField } from "./core-domain.ts";
import { once, outbox, type Sql, type Tx } from "./core-store.ts";
import { RequestError, type Principal } from "./request-context.ts";
import { jsonObject, jsonParam } from "./database-json.ts";
import {
  cardFields, cardValue, productColumn, readCard, readSupplierLink, recordCardRevision,
  sharedFields, valuesEqual, type SupplierLinkChange,
} from "./card-revision-data.ts";

type Row = Record<string, unknown>;
const json = (value: unknown) => Response.json(value, { headers: { "cache-control": "no-store" } });

function revision(row: Row) {
  const snapshot = jsonObject(row.snapshot);
  const data = jsonObject(snapshot.cardRevision);
  const before = jsonObject(data.before);
  const after = jsonObject(data.after);
  const fields = cardFields.filter(field => Object.hasOwn(before, field) && Object.hasOwn(after, field));
  const supplierLink = data.supplierLink as SupplierLinkChange | null | undefined;
  return {
    before, after, fields, supplierLink,
    legacyValues: data.afterVersion ? [] : cardFields.flatMap(field => {
      const key = Object.hasOwn(snapshot, field) ? field : productColumn(field);
      return Object.hasOwn(snapshot, key) ? [{ field, before: snapshot[key] }] : [];
    }),
    afterVersion: typeof data.afterVersion === "string" ? data.afterVersion : null,
    masterProductId: data.masterProductId ?? null,
    metadata: {
      id: row.id, reason: row.reason, actor: row.createdBy, createdAt: row.createdAt,
      changeSetId: row.changeSetId, source: data.source ?? null, note: data.note ?? null,
      rollbackOf: data.rollbackOf ?? null,
    },
  };
}

async function inspect(db: Sql | Tx, principal: Principal, productId: string, revisionId: string, lock = false) {
  const org = principal.organizationId;
  const card = await readCard(db, org, productId, lock);
  if (!card) throw new RequestError("product_not_found", 404);
  const [row] = await db`SELECT * FROM public."ProductRevision" WHERE "id"=${revisionId} AND "productId"=${productId}`;
  if (!row) throw new RequestError("revision_not_found", 404);
  const record = revision(row);
  let blocked: string | null = null;
  if (!record.afterVersion || (!record.fields.length && !record.supplierLink)) {
    blocked = "revision_snapshot_unavailable";
  } else if (card.snapshotVersion !== record.afterVersion ||
    card.masterProductId !== record.masterProductId ||
    record.fields.some(field => !valuesEqual(cardValue(card, field), record.after[field]))) {
    blocked = "revision_conflict";
  } else if (card.masterProductId && record.fields.some(field => sharedFields.has(field))) {
    blocked = "variant_shared_fields_readonly";
  }
  if (!blocked && record.fields.includes("categoryKey") && typeof record.before.categoryKey === "string" &&
      record.before.categoryKey && record.before.categoryKey !== "Без категории") {
    const [category] = await db`SELECT "key" FROM public."CatalogCategory"
      WHERE "organizationId"=${org} AND "key"=${record.before.categoryKey} AND "isActive"=true
      ${lock ? db`FOR SHARE` : db``}`;
    if (!category) blocked = "revision_category_unavailable";
  }
  if (!blocked && record.supplierLink) {
    if (!principal.scopes.includes("*") && !principal.scopes.includes("imports:write")) {
      blocked = "revision_import_scope_required";
    } else {
      const link = record.supplierLink;
      const [supplier] = await db`SELECT "id" FROM public."Supplier"
        WHERE "id"=${link.supplierId} AND "organizationId"=${org} AND "isActive"=true
        ${lock ? db`FOR SHARE` : db``}`;
      const live = await readSupplierLink(db, org, productId, link.supplierId, lock);
      if (!supplier || !valuesEqual(live, link.after)) blocked = "revision_supplier_conflict";
      if (!blocked && typeof link.before?.supplierSku === "string") {
        const [other] = await db`SELECT "id" FROM public."SupplierProduct"
          WHERE "supplierId"=${link.supplierId} AND "supplierSku"=${link.before.supplierSku} AND "productId"<>${productId}`;
        if (other) blocked = "revision_supplier_conflict";
      }
    }
  }
  return { card, record, blocked };
}

async function restoreSupplierLink(tx: Tx, productId: string, link: SupplierLinkChange) {
  if (!link.before) {
    await tx`DELETE FROM public."SupplierProduct" WHERE "productId"=${productId} AND "supplierId"=${link.supplierId}`;
  } else if (link.after) {
    await tx`UPDATE public."SupplierProduct" sp SET
      "supplierSku"=previous."supplierSku", "purchasePrice"=previous."purchasePrice",
      "lastSeenAt"=previous."lastSeenAt", "updatedAt"=clock_timestamp()
      FROM jsonb_populate_record(NULL::public."SupplierProduct", ${jsonParam(tx,link.before)}) previous
      WHERE sp."productId"=${productId} AND sp."supplierId"=${link.supplierId}`;
  } else {
    await tx`INSERT INTO public."SupplierProduct"
      SELECT * FROM jsonb_populate_record(NULL::public."SupplierProduct", ${jsonParam(tx,link.before)})`;
  }
}

export async function handleRevisions(req: Request, route: string, url: URL, sql: Sql, principal: Principal) {
  const match = route.match(/^\/v1\/catalog\/products\/([^/]+)\/revisions(?:\/([^/]+)(\/rollback)?)?$/);
  if (!match) return null;
  const productId = textField(decodeURIComponent(match[1]), "product");
  const org = principal.organizationId;
  if (!match[2] && req.method === "GET") {
    const [exists] = await sql`SELECT "id" FROM public."Product" WHERE "id"=${productId} AND "organizationId"=${org}`;
    if (!exists) throw new RequestError("product_not_found", 404);
    const after = url.searchParams.get("after");
    const rows = await sql`SELECT r."id", r."reason", r."createdBy", r."createdAt", r."changeSetId",
      jsonb_build_object('cardRevision', (r."snapshot"->'cardRevision') - 'before' - 'after' - 'supplierLink') AS snapshot
      FROM public."ProductRevision" r
      WHERE r."productId"=${productId}
      AND (${after}::text IS NULL OR (r."createdAt",r."id") <
        (SELECT "createdAt","id" FROM public."ProductRevision" WHERE "id"=${after} AND "productId"=${productId}))
      ORDER BY r."createdAt" DESC,r."id" DESC LIMIT 21`;
    return json({ items: rows.slice(0,20).map(row => revision(row).metadata),
      nextCursor: rows.length > 20 ? rows[19].id : null });
  }
  const revisionId = textField(decodeURIComponent(match[2] ?? ""), "revision");
  if (!match[3] && req.method === "GET") {
    const { record, blocked } = await inspect(sql, principal, productId, revisionId);
    return json({ ...record.metadata, blocked, expectedVersion: record.afterVersion,
      supplierChanged: Boolean(record.supplierLink), legacyValues: record.legacyValues,
      changes: record.fields.map(field => ({ field, before: record.before[field], after: record.after[field] })) });
  }
  if (match[3] && req.method === "POST") {
    const body = await req.json();
    const note = textField(body.reason, "reason", 500);
    if (body.confirmed !== true) throw new RequestError("revision_confirmation_required");
    return json(await once(sql, req, principal, route, body, async tx => {
      const { card, record, blocked } = await inspect(tx, principal, productId, revisionId, true);
      if (blocked) throw new RequestError(blocked, blocked === "revision_import_scope_required" ? 403 : 409);
      if (body.expectedVersion !== record.afterVersion) throw new RequestError("revision_conflict", 409);
      let supplierLink: SupplierLinkChange | undefined;
      if (record.supplierLink) {
        try {
          await restoreSupplierLink(tx, productId, record.supplierLink);
        } catch (error) {
          if ((error as {code?: string}).code === "23505") throw new RequestError("revision_supplier_conflict", 409);
          throw error;
        }
        supplierLink = {
          supplierId: record.supplierLink.supplierId,
          before: record.supplierLink.after,
          after: await readSupplierLink(tx, org, productId, record.supplierLink.supplierId),
        };
      }
      const values = Object.fromEntries(record.fields.map(field => {
        const value = record.before[field];
        const jsonField = field === "attributes" || field === "images";
        return [productColumn(field), jsonField && value !== null ? jsonParam(tx,value) : value];
      }));
      const updatedAt = new Date(Math.max(Date.now(), new Date(card.updatedAt).getTime() + 1));
      const [restored] = await tx`UPDATE public."Product" SET ${tx({...values, updatedAt})}
        WHERE "id"=${productId} AND "organizationId"=${org}
        RETURNING *, "updatedAt"::text AS "snapshotVersion"`;
      const newRevisionId = await recordCardRevision(tx, {
        productId, actor: principal.actor, reason: "CARD_ROLLBACK", before: card, after: restored,
        fields: record.fields, legacySnapshot: record.after, rollbackOf: revisionId, note, supplierLink,
      });
      await outbox(tx, org, "catalog.product_changed", {
        productId, actor: principal.actor, changedFields: record.fields, revisionId: newRevisionId, rollbackOf: revisionId,
      });
      return { status: "ROLLED_BACK", revisionId: newRevisionId, updatedAt: new Date(restored.updatedAt).toISOString() };
    }));
  }
  throw new RequestError("method_not_allowed", 405);
}
