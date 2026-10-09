import { handleCardEditor } from "./card-editor.ts";
import postgres from "npm:postgres@3.4.7";
import * as jose from "npm:jose@6.1.0";

const databaseUrl = Deno.env.get("SUPABASE_DB_URL")!;
const sql = postgres(databaseUrl, { prepare: false, max: 1 });

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function routePath(req: Request) {
  const pathname = new URL(req.url).pathname;
  const marker = "/catalog-hub";
  const index = pathname.indexOf(marker);
  const raw = index >= 0 ? pathname.slice(index + marker.length) : pathname;
  const normalized = raw.replace(/\/+$/, "");
  return normalized || "/";
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const VERCEL_OIDC_ISSUERS = [
  "https://oidc.vercel.com/vitaliys-projects-13789f27",
  "https://oidc.vercel.com",
] as const;
const VERCEL_OIDC_AUDIENCE =
  "https://vercel.com/vitaliys-projects-13789f27";
const VERCEL_OWNER_ID = "team_YWKSvspAA13TCOqdPiW95pzB";
const VERCEL_PROJECT_ID = "prj_wOZAjfZrBuo3AK5mHW9FSdD7VAf1";
const VERCEL_PROJECT_NAME = "catalog-hub-web";
// Match the JWKS URL to the verified issuer mode (team or global).
// Never fetch a URL supplied by a caller: only these two issuers are trusted.
const VERCEL_JWKS_BY_ISSUER = new Map(
  VERCEL_OIDC_ISSUERS.map((issuer) => [
    issuer,
    jose.createRemoteJWKSet(new URL(issuer + "/.well-known/jwks")),
  ] as const),
);

async function authorizeVercelOidc(req: Request) {
  const authorization = (req.headers.get("authorization") || "").trim();
  if (!authorization.toLowerCase().startsWith("bearer ")) return false;

  const token = authorization.slice(7).trim();
  if (!token) return false;

  try {
    // Unverified claims select a hardcoded trusted issuer only; jwtVerify
    // validates the signature, issuer, audience, and expiration afterwards.
    const issuer = jose.decodeJwt(token).iss;
    if (typeof issuer !== "string") return false;
    const jwks = VERCEL_JWKS_BY_ISSUER.get(issuer);
    if (!jwks) return false;
    const { payload } = await jose.jwtVerify(token, jwks, {
      issuer,
      audience: VERCEL_OIDC_AUDIENCE,
    });

    const environment =
      typeof payload.environment === "string" ? payload.environment : "";
    const project =
      typeof payload.project === "string" ? payload.project : "";
    const projectId =
      typeof payload.project_id === "string" ? payload.project_id : "";
    const ownerId =
      typeof payload.owner_id === "string" ? payload.owner_id : "";

    return (
      ownerId === VERCEL_OWNER_ID &&
      projectId === VERCEL_PROJECT_ID &&
      project === VERCEL_PROJECT_NAME &&
      (environment === "production" || environment === "preview")
    );
  } catch {
    return false;
  }
}

async function authorizeApiKey(req: Request) {
  const value = (req.headers.get("x-catalog-hub-key") || "").trim();
  if (!value) return false;

  const hash = await sha256Hex(value);
  const rows = await sql<
    { id: string }[]
  >`SELECT "id" FROM public."CatalogApiKey"
      WHERE "keyHash" = ${hash} AND "isActive" = true
      LIMIT 1`;

  if (!rows.length) return false;

  void sql`UPDATE public."CatalogApiKey"
           SET "lastUsedAt" = now()
           WHERE "id" = ${rows[0].id}`.catch(() => {});
  return true;
}

async function authorize(req: Request) {
  if (await authorizeVercelOidc(req)) return true;
  return authorizeApiKey(req);
}

type ProductRow = {
  id: string;
  organizationId: string;
  sku: string;
  barcode: string | null;
  title: string;
  brand: string | null;
  shortDescription: string | null;
  description: string | null;
  application: string | null;
  ingredients: string | null;
  categoryKey: string | null;
  attributes: unknown;
  images: unknown;
  purchasePrice: number | null;
  basePrice: number | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

// Old catalog imports stored JSON objects and arrays as serialized strings
// inside jsonb columns. Decode them when reading; never modify the source row.
function decodeLegacyJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function readAttributes(value: unknown): unknown {
  const parsed = decodeLegacyJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed
    : value ?? {};
}
function readImages(value: unknown): string[] {
  const parsed = decodeLegacyJson(value);
  return Array.isArray(parsed)
    ? parsed.filter((src): src is string => typeof src === "string")
    : [];
}

async function serializeProduct(product: ProductRow) {
  const inventory = await sql<
    {
      warehouseId: string;
      onHand: number;
      reserved: number;
      safetyStock: number;
      code: string;
      name: string;
    }[]
  >`
    SELECT
      i."warehouseId",
      i."onHand",
      i."reserved",
      i."safetyStock",
      w."code",
      w."name"
    FROM public."Inventory" i
    JOIN public."Warehouse" w ON w."id" = i."warehouseId"
    WHERE i."productId" = ${product.id}
    ORDER BY w."code" ASC
  `;

  const stock = inventory.reduce((sum, item) => sum + item.onHand, 0);
  const reserved = inventory.reduce((sum, item) => sum + item.reserved, 0);
  const safetyStock = inventory.reduce(
    (sum, item) => sum + item.safetyStock,
    0,
  );

  return {
    id: product.id,
    organizationId: product.organizationId,
    sku: product.sku,
    barcode: product.barcode,
    title: product.title,
    brand: product.brand,
    shortDescription: product.shortDescription,
    description: product.description,
    application: product.application,
    ingredients: product.ingredients,
    categoryKey: product.categoryKey,
    attributes: readAttributes(product.attributes),
    images: readImages(product.images),
    purchasePrice: product.purchasePrice,
    price: product.basePrice,
    inventory: inventory.map((item) => ({
      warehouseId: item.warehouseId,
      warehouseCode: item.code,
      warehouseName: item.name,
      onHand: item.onHand,
      reserved: item.reserved,
      safetyStock: item.safetyStock,
      available: Math.max(
        0,
        item.onHand - item.reserved - item.safetyStock,
      ),
    })),
    totals: {
      stock,
      reserved,
      safetyStock,
      available: Math.max(0, stock - reserved - safetyStock),
    },
    createdAt: new Date(product.createdAt).toISOString(),
    updatedAt: new Date(product.updatedAt).toISOString(),
  };
}

async function getBySku(organizationId: string, sku: string) {
  const rows = await sql<ProductRow[]>`
    SELECT *
    FROM public."Product"
    WHERE "organizationId" = ${organizationId}
      AND "sku" = ${sku}
    LIMIT 1
  `;
  return rows[0] ? serializeProduct(rows[0]) : null;
}

function optionalString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function optionalNonNegativeInt(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error("invalid_integer");
  return n;
}

async function createProduct(body: any) {
  const organizationId = optionalString(body?.organizationId);
  const warehouseId = optionalString(body?.warehouseId);
  const card = body?.card ?? {};
  const sku = optionalString(card.sku);
  const title = optionalString(card.title);

  if (!organizationId) throw new Error("organizationId_required");
  if (!sku) throw new Error("sku_required");
  if (!title) throw new Error("title_required");

  const purchasePrice = optionalNonNegativeInt(card.purchasePrice);
  const price = optionalNonNegativeInt(card.price);
  const stock =
    card.stock === undefined ? null : optionalNonNegativeInt(card.stock);

  if (stock !== null && !warehouseId) {
    throw new Error("warehouse_required_for_stock");
  }

  const organization = await sql<{ id: string }[]>`
    SELECT "id" FROM public."Organization"
    WHERE "id" = ${organizationId}
    LIMIT 1
  `;
  if (!organization.length) throw new Error("organization_not_found");

  if (warehouseId) {
    const warehouse = await sql<{ id: string }[]>`
      SELECT "id" FROM public."Warehouse"
      WHERE "id" = ${warehouseId}
        AND "organizationId" = ${organizationId}
        AND "isActive" = true
      LIMIT 1
    `;
    if (!warehouse.length) throw new Error("warehouse_not_found");
  }

  const id = crypto.randomUUID();
  const now = new Date();
  const attributes = JSON.stringify(
    card.attributes && typeof card.attributes === "object"
      ? card.attributes
      : {},
  );
  const images = JSON.stringify(
    Array.isArray(card.images)
      ? card.images.filter((value: unknown) => typeof value === "string")
      : [],
  );

  try {
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO public."Product" (
          "id","organizationId","sku","barcode","title","brand",
          "shortDescription","description","application","ingredients",
          "categoryKey","attributes","images","purchasePrice","basePrice",
          "createdAt","updatedAt"
        ) VALUES (
          ${id},
          ${organizationId},
          ${sku},
          ${optionalString(card.barcode)},
          ${title},
          ${optionalString(card.brand)},
          ${optionalString(card.shortDescription)},
          ${optionalString(card.description)},
          ${optionalString(card.application)},
          ${optionalString(card.ingredients)},
          ${optionalString(card.categoryKey)},
          ${attributes}::jsonb,
          ${images}::jsonb,
          ${purchasePrice},
          ${price},
          ${now},
          ${now}
        )
      `;

      if (warehouseId && stock !== null) {
        await tx`
          INSERT INTO public."Inventory" (
            "id","productId","warehouseId","onHand","reserved","safetyStock","updatedAt"
          ) VALUES (
            ${crypto.randomUUID()},
            ${id},
            ${warehouseId},
            ${stock},
            0,
            0,
            ${now}
          )
        `;
      }
    });
  } catch (error) {
    const message = String((error as Error)?.message || error);
    if (message.includes("Product_organizationId_sku_key")) {
      throw new Error("sku_already_exists");
    }
    throw error;
  }

  const rows = await sql<ProductRow[]>`
    SELECT * FROM public."Product" WHERE "id" = ${id} LIMIT 1
  `;
  return serializeProduct(rows[0]);
}

async function bulkCreateProducts(body: any) {
  const items = Array.isArray(body?.items) ? body.items : null;
  if (!items) throw new Error("items_required");
  if (items.length < 1 || items.length > 100) {
    throw new Error("bulk_size_invalid");
  }

  const results: Array<Record<string, unknown>> = [];
  for (const item of items) {
    const sku = optionalString(item?.card?.sku);
    try {
      const product = await createProduct(item);
      results.push({ sku, status: "CREATED", id: product.id });
    } catch (error) {
      const message = String((error as Error)?.message || error);
      if (message === "sku_already_exists") {
        results.push({ sku, status: "ALREADY_EXISTS" });
      } else {
        results.push({ sku, status: "ERROR", error: message });
      }
    }
  }

  return {
    summary: {
      total: items.length,
      created: results.filter((item) => item.status === "CREATED").length,
      alreadyExists: results.filter((item) => item.status === "ALREADY_EXISTS").length,
      errors: results.filter((item) => item.status === "ERROR").length,
    },
    results,
  };
}

async function listCatalogSkus(url: URL) {
  const organizationId = (url.searchParams.get("organizationId") || "").trim();
  if (!organizationId) throw new Error("organizationId_required");

  const rows = await sql<{ sku: string }[]>`
    SELECT "sku"
    FROM public."Product"
    WHERE "organizationId" = ${organizationId}
    ORDER BY "sku" ASC
  `;

  return {
    skus: rows.map((row) => row.sku),
    total: rows.length,
  };
}

async function catalogSnapshot(url: URL) {
  const organizationId = (url.searchParams.get("organizationId") || "").trim();
  if (!organizationId) throw new Error("organizationId_required");

  const rows = await sql<
    {
      id: string;
      sku: string;
      barcode: string | null;
      title: string;
      brand: string | null;
      shortDescription: string | null;
      description: string | null;
      application: string | null;
      ingredients: string | null;
      categoryKey: string | null;
      attributes: unknown;
      images: unknown;
      purchasePrice: number | null;
      price: number | null;
      stock: number;
      available: number;
      createdAt: string | Date;
      updatedAt: string | Date;
    }[]
  >`
    SELECT
      p."id",
      p."sku",
      p."barcode",
      p."title",
      p."brand",
      p."shortDescription",
      p."description",
      p."application",
      p."ingredients",
      p."categoryKey",
      p."attributes",
      p."images",
      p."purchasePrice",
      p."basePrice" AS "price",
      COALESCE(SUM(i."onHand"), 0)::int AS "stock",
      COALESCE(
        SUM(GREATEST(i."onHand" - i."reserved" - i."safetyStock", 0)),
        0
      )::int AS "available",
      p."createdAt",
      p."updatedAt"
    FROM public."Product" p
    LEFT JOIN public."Inventory" i ON i."productId" = p."id"
    WHERE p."organizationId" = ${organizationId}
    GROUP BY p."id"
    ORDER BY p."sku" ASC
  `;

  return {
    items: rows.map((row) => ({
      ...row,
      attributes: readAttributes(row.attributes),
      images: readImages(row.images),
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    })),
    total: rows.length,
  };
}

function requiredOrganizationId(url: URL) {
  const organizationId = (url.searchParams.get("organizationId") || "").trim();
  if (!organizationId) throw new Error("organizationId_required");
  return organizationId;
}

async function getProductById(url: URL, id: string) {
  const organizationId = requiredOrganizationId(url);
  const rows = await sql<ProductRow[]>`
    SELECT *
    FROM public."Product"
    WHERE "id" = ${id}
      AND "organizationId" = ${organizationId}
    LIMIT 1
  `;
  return rows[0] ? serializeProduct(rows[0]) : null;
}

async function listSuppliersForUi(url: URL) {
  const organizationId = requiredOrganizationId(url);
  return sql`
    SELECT
      s."id", s."code", s."name", s."isActive",
      s."createdAt", s."updatedAt",
      json_build_object(
        'products', count(DISTINCT sp."id")::int,
        'sourcePolicies', count(DISTINCT csp."id")::int
      ) AS "_count"
    FROM public."Supplier" s
    LEFT JOIN public."SupplierProduct" sp ON sp."supplierId" = s."id"
    LEFT JOIN public."CatalogSourcePolicy" csp ON csp."supplierId" = s."id"
    WHERE s."organizationId" = ${organizationId}
    GROUP BY s."id"
    ORDER BY s."name" ASC, s."code" ASC
  `;
}

async function listSourcePoliciesForUi(url: URL) {
  const organizationId = requiredOrganizationId(url);
  return sql`
    SELECT
      csp.*,
      json_build_object(
        'id', s."id",
        'code', s."code",
        'name', s."name"
      ) AS "supplier"
    FROM public."CatalogSourcePolicy" csp
    JOIN public."Supplier" s ON s."id" = csp."supplierId"
    WHERE s."organizationId" = ${organizationId}
      AND csp."isEnabled" = true
    ORDER BY csp."priority" DESC, csp."domain" ASC
  `;
}

async function listMediaProfilesForUi(url: URL) {
  const organizationId = requiredOrganizationId(url);
  return sql`
    SELECT *
    FROM public."MediaProfile"
    WHERE "organizationId" = ${organizationId}
      AND "isActive" = true
    ORDER BY COALESCE("target", ''), "code"
  `;
}

async function listEnrichmentProposalsForUi(url: URL) {
  const organizationId = requiredOrganizationId(url);
  const limit = Math.max(
    1,
    Math.min(100, Math.trunc(Number(url.searchParams.get("limit") || 50))),
  );
  const status = (url.searchParams.get("status") || "").trim();

  return sql`
    SELECT
      cep."id",
      cep."confidence",
      cep."status",
      cep."sourceUrl",
      cep."title",
      cep."shortDescription",
      cep."description",
      cep."application",
      cep."ingredients",
      cep."images",
      cep."warnings",
      cep."evaluation",
      cep."createdAt",
      json_build_object(
        'id', p."id",
        'sku', p."sku",
        'title', p."title",
        'brand', p."brand"
      ) AS "product"
    FROM public."CatalogEnrichmentProposal" cep
    JOIN public."Product" p ON p."id" = cep."productId"
    WHERE p."organizationId" = ${organizationId}
      AND (${status} = '' OR cep."status"::text = ${status})
    ORDER BY cep."createdAt" DESC
    LIMIT ${limit}
  `;
}

async function listChangeSetsForUi(url: URL) {
  const organizationId = requiredOrganizationId(url);
  const limit = Math.max(
    1,
    Math.min(100, Math.trunc(Number(url.searchParams.get("limit") || 50))),
  );
  const status = (url.searchParams.get("status") || "").trim();

  return sql`
    SELECT
      cs."id",
      cs."sku",
      cs."sourceType",
      cs."sourceRef",
      cs."status",
      cs."summary",
      cs."createdAt",
      CASE WHEN p."id" IS NULL THEN NULL ELSE
        json_build_object(
          'id', p."id",
          'sku', p."sku",
          'title', p."title",
          'brand', p."brand"
        )
      END AS "product",
      COALESCE(
        json_agg(
          json_build_object(
            'id', f."id",
            'field', f."field",
            'risk', f."risk",
            'status', f."status",
            'beforeValue', f."beforeValue",
            'afterValue', f."afterValue"
          )
          ORDER BY f."createdAt" ASC
        ) FILTER (WHERE f."id" IS NOT NULL),
        '[]'::json
      ) AS "fields"
    FROM public."CatalogChangeSet" cs
    LEFT JOIN public."Product" p ON p."id" = cs."productId"
    LEFT JOIN public."CatalogFieldChange" f ON f."changeSetId" = cs."id"
    WHERE cs."organizationId" = ${organizationId}
      AND (${status} = '' OR cs."status"::text = ${status})
    GROUP BY cs."id", p."id"
    ORDER BY cs."createdAt" DESC
    LIMIT ${limit}
  `;
}

async function listProducts(url: URL) {
  const organizationId = (url.searchParams.get("organizationId") || "").trim();
  if (!organizationId) throw new Error("organizationId_required");

  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.max(
    1,
    Math.min(100, Math.trunc(Number(url.searchParams.get("limit") || 50))),
  );
  const offset = Math.max(
    0,
    Math.trunc(Number(url.searchParams.get("offset") || 0)),
  );
  const pattern = `%${q}%`;

  const items = await sql<ProductRow[]>`
    SELECT *
    FROM public."Product"
    WHERE "organizationId" = ${organizationId}
      AND (
        ${q} = ''
        OR "sku" ILIKE ${pattern}
        OR "title" ILIKE ${pattern}
        OR COALESCE("brand",'') ILIKE ${pattern}
        OR COALESCE("barcode",'') ILIKE ${pattern}
      )
    ORDER BY "updatedAt" DESC, "id" ASC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [{ count }] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM public."Product"
    WHERE "organizationId" = ${organizationId}
      AND (
        ${q} = ''
        OR "sku" ILIKE ${pattern}
        OR "title" ILIKE ${pattern}
        OR COALESCE("brand",'') ILIKE ${pattern}
        OR COALESCE("barcode",'') ILIKE ${pattern}
      )
  `;

  return {
    items: await Promise.all(items.map(serializeProduct)),
    pagination: {
      total: count,
      limit,
      offset,
      hasMore: offset + items.length < count,
    },
  };
}

Deno.serve(async (req: Request) => {
  const route = routePath(req);
  const url = new URL(req.url);

  try {
    if (req.method === "GET" && route === "/health") {
      return json({
        ok: true,
        service: "catalog-hub",
        version: "0.9.1-edge",
        mode: "supabase-edge",
      });
    }

    if (req.method === "GET" && route === "/ready") {
      const [{ ok }] = await sql<{ ok: number }[]>`SELECT 1::int AS ok`;
      const [{ keys }] = await sql<{ keys: number }[]>`
        SELECT count(*)::int AS keys
        FROM public."CatalogApiKey"
        WHERE "isActive" = true
      `;
      const ready = ok === 1 && keys > 0;
      return json({ ready, database: ok === 1, authConfigured: keys > 0 }, ready ? 200 : 503);
    }

    if (!route.startsWith("/v1/")) {
      return json({ error: "not_found" }, 404);
    }

    if (!(await authorize(req))) {
      return json({ error: "unauthorized" }, 401);
    }

    const cardEditor = await handleCardEditor(req, route, url, sql);
    if (cardEditor) return cardEditor;

    const productById = route.match(/^\/v1\/catalog\/products\/([^/]+)$/);
    if (req.method === "GET" && productById) {
      const product = await getProductById(url, decodeURIComponent(productById[1]));
      return product
        ? json(product)
        : json({ error: "product_not_found" }, 404);
    }

    if (route === "/v1/suppliers" && req.method === "GET") {
      return json(await listSuppliersForUi(url));
    }

    if (route === "/v1/source-policies" && req.method === "GET") {
      return json(await listSourcePoliciesForUi(url));
    }

    if (route === "/v1/media/profiles" && req.method === "GET") {
      return json(await listMediaProfilesForUi(url));
    }

    if (route === "/v1/ai/enrichment/proposals" && req.method === "GET") {
      return json(await listEnrichmentProposalsForUi(url));
    }

    if (route === "/v1/staging/changesets" && req.method === "GET") {
      return json(await listChangeSetsForUi(url));
    }

    const bySku = route.match(/^\/v1\/catalog\/by-sku\/(.+)$/);
    if (req.method === "GET" && bySku) {
      const organizationId = (url.searchParams.get("organizationId") || "").trim();
      if (!organizationId) return json({ error: "organizationId_required" }, 400);

      const sku = decodeURIComponent(bySku[1]);
      const product = await getBySku(organizationId, sku);
      return product ? json(product) : json({ error: "product_not_found" }, 404);
    }

    if (route === "/v1/catalog/skus" && req.method === "GET") {
      try {
        return json(await listCatalogSkus(url));
      } catch (error) {
        const message = String((error as Error)?.message || error);
        if (message === "organizationId_required") {
          return json({ error: message }, 400);
        }
        throw error;
      }
    }

    if (route === "/v1/catalog/snapshot" && req.method === "GET") {
      try {
        return json(await catalogSnapshot(url));
      } catch (error) {
        const message = String((error as Error)?.message || error);
        if (message === "organizationId_required") {
          return json({ error: message }, 400);
        }
        throw error;
      }
    }

    if (route === "/v1/catalog/products" && req.method === "GET") {
      return json(await listProducts(url));
    }

    if (route === "/v1/catalog/products/bulk" && req.method === "POST") {
      const body = await req.json();
      try {
        return json(await bulkCreateProducts(body), 200);
      } catch (error) {
        const message = String((error as Error)?.message || error);
        if (message === "items_required" || message === "bulk_size_invalid") {
          return json({ error: message }, 400);
        }
        throw error;
      }
    }

    if (route === "/v1/catalog/products" && req.method === "POST") {
      const body = await req.json();
      try {
        const product = await createProduct(body);
        return json(product, 201);
      } catch (error) {
        const message = String((error as Error)?.message || error);
        if (message === "sku_already_exists") {
          return json({ error: message }, 409);
        }
        if (
          message.endsWith("_required") ||
          message.endsWith("_not_found") ||
          message === "invalid_integer" ||
          message === "warehouse_required_for_stock"
        ) {
          return json({ error: message }, 400);
        }
        throw error;
      }
    }

    return json({ error: "not_found" }, 404);
  } catch (error) {
    console.error("catalog_hub_edge_error", error);
    return json(
      { error: String((error as Error)?.message || error || "internal_error") },
      500,
    );
  }
});
