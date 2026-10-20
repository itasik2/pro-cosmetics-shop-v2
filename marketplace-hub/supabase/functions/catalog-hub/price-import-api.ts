import type postgres from "npm:postgres@3.4.7";

type Sql = ReturnType<typeof postgres>;
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status,
    headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
function string(value: unknown, max = 128) {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : "";
}
function day(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function today() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Almaty", year: "numeric",
    month: "2-digit", day: "2-digit" }).format(new Date());
}
async function bodyOf(req: Request) {
  if (Number(req.headers.get("content-length") || 0) > 25000) fail("payload_too_large", 413);
  const value: unknown = await req.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(value).length > 25000)
    fail("invalid_body");
  return value as Record<string, unknown>;
}

export async function handlePriceImport(req: Request, route: string, url: URL, sql: Sql): Promise<Response | null> {
  try {
    if (route === "/v1/price-import/suppliers" && req.method === "POST") {
      const body = await bodyOf(req);
      const organizationId = string(body.organizationId), name = string(body.name, 120);
      if (!organizationId || !name) fail("supplier_required");
      const code = string(body.code, 60).toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{1,59}$/.test(code)) fail("supplier_code_invalid");
      const org = await sql`SELECT "id" FROM public."Organization" WHERE "id"=${organizationId}`;
      if (!org.length) fail("organization_not_found", 404);
      const matches = await sql`SELECT "id" FROM public."Supplier" WHERE "organizationId"=${organizationId}
        AND ("code"=${code} OR lower("name")=lower(${name})) LIMIT 1`;
      if (matches.length) fail("supplier_already_exists", 409);
      const id = crypto.randomUUID();
      await sql`INSERT INTO public."Supplier" ("id","organizationId","name","code","isActive","createdAt","updatedAt")
        VALUES (${id},${organizationId},${name},${code},true,now(),now())`;
      return json({ id, name, code, isActive: true }, 201);
    }
    if (route === "/v1/price-import/profiles" && req.method === "GET") {
      const organizationId = string(url.searchParams.get("organizationId"));
      if (!organizationId) fail("organizationId_required");
      return json(await sql`SELECT p."id",p."supplierId",p."name",p."mapping",p."fileType",p."updatedAt"
        FROM public."ImportProfile" p JOIN public."Supplier" s ON s."id"=p."supplierId"
        WHERE s."organizationId"=${organizationId} ORDER BY p."updatedAt" DESC LIMIT 100`);
    }
    if (route === "/v1/price-import/profiles" && req.method === "POST") {
      const body = await bodyOf(req);
      const organizationId = string(body.organizationId), supplierId = string(body.supplierId);
      const name = string(body.name, 120), fileType = string(body.fileType, 20) || "AUTO";
      if (!organizationId || !supplierId || !name) fail("profile_fields_required");
      if (!body.mapping || typeof body.mapping !== "object" || Array.isArray(body.mapping) ||
          JSON.stringify(body.mapping).length > 6000 ||
          Object.entries(body.mapping).some(([key, value]) =>
            !["sku","barcode","title","brand","volume","purchasePrice","price","description","categoryKey","stock"].includes(key) ||
            typeof value !== "string" || value.length > 120)) fail("profile_mapping_invalid");
      const supplier = await sql`SELECT "id" FROM public."Supplier" WHERE "id"=${supplierId}
        AND "organizationId"=${organizationId} AND "isActive"=true`;
      if (!supplier.length) fail("supplier_not_found", 404);
      const id = string(body.id);
      const rows = id ? await sql`UPDATE public."ImportProfile" SET "name"=${name},"mapping"=${sql.json(body.mapping)},
          "fileType"=${fileType},"updatedAt"=now() WHERE "id"=${id} AND "supplierId"=${supplierId}
          RETURNING "id","supplierId","name","mapping","fileType","updatedAt"`
        : await sql`INSERT INTO public."ImportProfile" ("id","supplierId","name","fileType","mapping","isDefault","createdAt","updatedAt")
          VALUES (${crypto.randomUUID()},${supplierId},${name},${fileType},${sql.json(body.mapping)},false,now(),now())
          RETURNING "id","supplierId","name","mapping","fileType","updatedAt"`;
      if (!rows.length) fail("profile_not_found", 404);
      return json(rows[0], id ? 200 : 201);
    }
    if (route === "/v1/price-import/history" && req.method === "GET") {
      const organizationId = string(url.searchParams.get("organizationId"));
      const supplierId = string(url.searchParams.get("supplierId"));
      if (!organizationId) fail("organizationId_required");
      return json(await sql`SELECT i."id",i."supplierId",s."name" AS "supplierName",i."filename",
        i."sourceType",i."status",i."rowCount",i."validRows",i."invalidRows",i."appliedAt",i."createdAt"
        FROM public."PriceImport" i JOIN public."Supplier" s ON s."id"=i."supplierId"
        WHERE s."organizationId"=${organizationId} AND (${!supplierId} OR i."supplierId"=${supplierId})
        ORDER BY i."createdAt" DESC LIMIT 100`);
    }
    if (route === "/v1/price-import/history" && req.method === "POST") {
      const body = await bodyOf(req);
      const organizationId = string(body.organizationId), supplierId = string(body.supplierId);
      const filename = string(body.filename, 200), sourceDate = body.sourceDate;
      const rows = body.rows;
      if (!organizationId || !supplierId || !filename || !day(sourceDate) ||
          !Array.isArray(rows) || rows.length < 1 || rows.length > 20 ||
          rows.some(row => !row || typeof row !== "object" || !Number.isInteger(row.rowNumber) ||
            row.rowNumber < 1 || !["AUTO_APPLIED","STAGED","CREATED","ERROR"].includes(row.status) ||
            typeof row.sku !== "string" || row.sku.length > 100)) fail("history_invalid");
      const supplier = await sql`SELECT "id" FROM public."Supplier" WHERE "id"=${supplierId}
        AND "organizationId"=${organizationId} LIMIT 1`;
      if (!supplier.length) fail("supplier_not_found", 404);
      const id = crypto.randomUUID();
      await sql.begin(async tx => {
        await tx`INSERT INTO public."PriceImport" ("id","supplierId","filename","sourceType","status",
          "rowCount","validRows","invalidRows","appliedAt","createdAt") VALUES
          (${id},${supplierId},${filename},'CATALOG_HUB',
           ${rows.some(row => row.status === "ERROR") ? "FAILED" : "APPLIED"}::public."ImportStatus",
           ${rows.length},${rows.filter(row => row.status !== "ERROR").length},
           ${rows.filter(row => row.status === "ERROR").length},now(),now())`;
        for (const row of rows) {
          await tx`INSERT INTO public."PriceImportRow" ("id","importId","rowNumber","supplierSku","raw","errors","createdAt")
            VALUES (${crypto.randomUUID()},${id},${row.rowNumber},${row.sku},
            ${tx.json({status:row.status,sourceDate,productId:row.productId||null,changeSetId:row.changeSetId||null})}::jsonb,
            ${tx.json(row.error ? [String(row.error).slice(0,300)] : [])}::jsonb,now())`;
        }
      });
      return json({id}, 201);
    }
    if (route !== "/v1/price-import/auto" || req.method !== "POST") return null;
    const input = await bodyOf(req);
    const organizationId = string(input.organizationId), supplierId = string(input.supplierId);
    const productId = string(input.productId), sku = string(input.sku, 100);
    const title = string(input.title, 500), brand = typeof input.brand === "string" ? input.brand : null;
    const sourceDate = input.sourceDate, fileName = string(input.fileName, 200);
    const fileSha256 = string(input.fileSha256, 64);
    const price = input.price, purchasePrice = input.purchasePrice;
    if (!organizationId || !supplierId || !productId || !sku || !title || !fileName ||
        !day(sourceDate) || sourceDate > today() || !/^[a-f0-9]{64}$/.test(fileSha256) ||
        (price === undefined && purchasePrice === undefined) ||
        (price !== undefined && (!Number.isSafeInteger(price) || Number(price) <= 0)) ||
        (purchasePrice !== undefined && (!Number.isSafeInteger(purchasePrice) || Number(purchasePrice) < 0)))
      fail("invalid_price_import");
    const result = await sql.begin(async tx => {
      const rows = await tx`SELECT p."id",p."sku",p."title",p."brand",p."basePrice",p."purchasePrice",
        p."attributes",p."updatedAt" FROM public."Product" p WHERE p."id"=${productId}
        AND p."organizationId"=${organizationId} FOR UPDATE`;
      if (!rows.length) fail("product_not_found", 404);
      const current = rows[0];
      const link = await tx`SELECT sp."id",sp."supplierSku" FROM public."SupplierProduct" sp
        JOIN public."Supplier" s ON s."id"=sp."supplierId" WHERE sp."productId"=${productId}
        AND sp."supplierId"=${supplierId} AND s."organizationId"=${organizationId} AND s."isActive"=true LIMIT 1`;
      const source = current.attributes && typeof current.attributes === "object" && !Array.isArray(current.attributes)
        ? current.attributes as Record<string, unknown> : {};
      const prior = source.supplierImport && typeof source.supplierImport === "object" && !Array.isArray(source.supplierImport)
        ? source.supplierImport as Record<string, unknown> : {};
      if (!link.length || !link[0].supplierSku || String(link[0].supplierSku).toUpperCase() !== sku.toUpperCase() ||
          prior.supplierId !== supplierId || !day(prior.sourceDate) || sourceDate <= String(prior.sourceDate) ||
          current.sku.toUpperCase() !== sku.toUpperCase() || current.title !== title || current.brand !== brand)
        fail("price_import_requires_review", 409);
      if ((price !== undefined && (typeof current.basePrice !== "number" || Number(price) < current.basePrice)) ||
          (purchasePrice !== undefined && (typeof current.purchasePrice !== "number" || Number(purchasePrice) < current.purchasePrice)))
        fail("price_decrease_requires_review", 409);
      if ((price === undefined || Number(price) === current.basePrice) &&
          (purchasePrice === undefined || Number(purchasePrice) === current.purchasePrice))
        fail("price_unchanged", 409);
      const updatedAttributes = { ...source, supplierImport: { ...prior, supplierId, sourceDate,
        fileName, sha256: fileSha256 } };
      await tx`INSERT INTO public."ProductRevision" ("id","productId","reason","snapshot","createdBy","createdAt")
        VALUES (${crypto.randomUUID()},${productId},'PRICE_IMPORT_AUTO',${tx.json({price:current.basePrice,
          purchasePrice:current.purchasePrice,attributes:source})}::jsonb,'catalog-hub-price-import',now())`;
      await tx`UPDATE public."Product" SET "basePrice"=${price === undefined ? current.basePrice : price as number},
        "purchasePrice"=${purchasePrice === undefined ? current.purchasePrice : purchasePrice as number},
        "attributes"=${tx.json(updatedAttributes)}::jsonb,"updatedAt"=now() WHERE "id"=${productId}`;
      await tx`UPDATE public."SupplierProduct" SET "lastSeenAt"=now(),
        "purchasePrice"=${purchasePrice === undefined ? current.purchasePrice : purchasePrice as number},
        "updatedAt"=now() WHERE "id"=${link[0].id}`;
      return { id: productId, status: "AUTO_APPLIED", price: price ?? current.basePrice,
        purchasePrice: purchasePrice ?? current.purchasePrice };
    });
    return json(result);
  } catch (error) {
    const status = typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status : 500;
    if (status === 500) console.error("price_import_error", error);
    return json({ error: status === 500 ? "price_import_failed" : String((error as Error).message) }, status);
  }
}
