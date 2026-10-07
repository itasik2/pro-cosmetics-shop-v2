import postgres from "npm:postgres@3.4.7";

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

async function authorize(req: Request) {
  const value = (req.headers.get("x-catalog-hub-key") || "").trim();
  if (!value) return false;

  const hash = await sha256Hex(value);
  const rows = await sql<{ id: string }[]>`
    SELECT "id"
    FROM public."CatalogApiKey"
    WHERE "keyHash" = ${hash} AND "isActive" = true
    LIMIT 1
  `;

  if (!rows.length) return false;

  void sql`
    UPDATE public."CatalogApiKey"
    SET "lastUsedAt" = now()
    WHERE "id" = ${rows[0].id}
  `.catch(() => {});

  return true;
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
    attributes: product.attributes ?? {},
    images: Array.isArray(product.images) ? product.images : [],
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
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error("invalid_integer");
  }
  return number;
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
    SELECT "id"
    FROM public."Organization"
    WHERE "id" = ${organizationId}
    LIMIT 1
  `;
  if (!organization.length) throw new Error("organization_not_found");

  if (warehouseId) {
    const warehouse = await sql<{ id: string }[]>`
      SELECT "id"
      FROM public."Warehouse"
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
            "id","productId","warehouseId","onHand",
            "reserved","safetyStock","updatedAt"
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
    SELECT *
    FROM public."Product"
    WHERE "id" = ${id}
    LIMIT 1
  `;

  return serializeProduct(rows[0]);
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
        version: "0.8.0-edge",
        mode: "supabase-edge",
      });
    }

    if (req.method === "GET" && route === "/ready") {
      const [{ ok }] = await sql<{ ok: number }[]>`
        SELECT 1::int AS ok
      `;
      const [{ keys }] = await sql<{ keys: number }[]>`
        SELECT count(*)::int AS keys
        FROM public."CatalogApiKey"
        WHERE "isActive" = true
      `;
      const ready = ok === 1 && keys > 0;
      return json(
        { ready, database: ok === 1, authConfigured: keys > 0 },
        ready ? 200 : 503,
      );
    }

    if (!route.startsWith("/v1/")) {
      return json({ error: "not_found" }, 404);
    }

    if (!(await authorize(req))) {
      return json({ error: "unauthorized" }, 401);
    }

    const bySku = route.match(/^\/v1\/catalog\/by-sku\/(.+)$/);
    if (req.method === "GET" && bySku) {
      const organizationId = (
        url.searchParams.get("organizationId") || ""
      ).trim();
      if (!organizationId) {
        return json({ error: "organizationId_required" }, 400);
      }

      const sku = decodeURIComponent(bySku[1]);
      const product = await getBySku(organizationId, sku);
      return product
        ? json(product)
        : json({ error: "product_not_found" }, 404);
    }

    if (route === "/v1/catalog/products" && req.method === "GET") {
      return json(await listProducts(url));
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
      {
        error: String(
          (error as Error)?.message || error || "internal_error",
        ),
      },
      500,
    );
  }
});
