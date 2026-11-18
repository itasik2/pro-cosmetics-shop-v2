import { canonical } from "./core-domain.ts";
import type { Sql, Tx } from "./core-store.ts";
import { jsonParam } from "./database-json.ts";

export const cardFields = [
  "title", "barcode", "brand", "categoryKey", "shortDescription", "description",
  "application", "ingredients", "purchasePrice", "price", "attributes", "images",
] as const;
export type CardField = typeof cardFields[number];
export const sharedFields = new Set<CardField>([
  "title", "brand", "categoryKey", "shortDescription", "description", "application", "ingredients",
]);
type Row = Record<string, unknown>;
export type SupplierLinkChange = { supplierId: string; before: Row | null; after: Row | null };
export const productColumn = (field: CardField) => field === "price" ? "basePrice" : field;

export function cardValue(row: Row, field: CardField) {
  return row[productColumn(field)] ?? null;
}
export function revisionValues(row: Row, fields: readonly CardField[]) {
  return Object.fromEntries(fields.map(field => [field, cardValue(row, field)]));
}
export function valuesEqual(a: unknown, b: unknown) {
  return canonical(a) === canonical(b);
}
export async function readCard(db: Sql | Tx, organizationId: string, productId: string, lock = false) {
  const [row] = await db`SELECT p.*, p."updatedAt"::text AS "snapshotVersion" FROM public."Product" p
    WHERE p."id"=${productId} AND p."organizationId"=${organizationId} ${lock ? db`FOR UPDATE` : db``}`;
  return row;
}
export async function readSupplierLink(db: Sql | Tx, organizationId: string, productId: string, supplierId: string, lock = false) {
  const [row] = await db`SELECT to_jsonb(sp) AS data FROM public."SupplierProduct" sp
    JOIN public."Supplier" s ON s."id"=sp."supplierId"
    WHERE sp."productId"=${productId} AND sp."supplierId"=${supplierId} AND s."organizationId"=${organizationId}
    ${lock ? db`FOR UPDATE OF sp` : db``}`;
  return (row?.data ?? null) as Row | null;
}
export async function recordCardRevision(tx: Tx, input: {
  productId: string;
  actor: string;
  reason: string;
  before: Row;
  after: Row;
  fields: readonly CardField[];
  legacySnapshot: Row;
  changeSetId?: string;
  source?: string;
  supplierLink?: SupplierLinkChange;
  rollbackOf?: string;
  note?: string;
}) {
  const id = crypto.randomUUID();
  const fields = input.fields.filter(field => !valuesEqual(cardValue(input.before, field), cardValue(input.after, field)));
  const snapshot = {
    ...input.legacySnapshot,
    cardRevision: {
      before: revisionValues(input.before, fields),
      after: revisionValues(input.after, fields),
      afterVersion: input.after.snapshotVersion,
      masterProductId: input.after.masterProductId ?? null,
      source: input.source ?? null,
      supplierLink: input.supplierLink ?? null,
      rollbackOf: input.rollbackOf ?? null,
      note: input.note ?? null,
    },
  };
  await tx`INSERT INTO public."ProductRevision" ("id","productId","changeSetId","reason","snapshot","createdBy")
    VALUES (${id},${input.productId},${input.changeSetId ?? null},${input.reason},${jsonParam(tx,snapshot)},${input.actor})`;
  return id;
}
