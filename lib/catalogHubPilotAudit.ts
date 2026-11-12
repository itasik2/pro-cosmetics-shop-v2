export const PILOT_AUDIT_LIMIT = 10_000;

export type PilotStoreProduct = {
  id: string;
  name: string;
  brand: string | null;
  supplierSku: string | null;
  barcode: string | null;
  price: number;
  stock: number;
  variants: unknown;
};

export type PilotHubProduct = {
  id: string;
  sku: string;
  title: string;
  brand: string | null;
  barcode: string | null;
  price: number | null;
  available: number;
};

export type PilotOrderLine = {
  orderId?: string;
  productId: string;
  variantId: string | null;
  sku: string | null;
  qty: number;
  status: string;
};
type OrderIssue = Pick<PilotOrderLine, "orderId" | "productId" | "variantId" | "sku"> & {
  reason: "MISSING_SKU" | "NO_MAPPING" | "SKU_CHANGED" | "INVALID_QUANTITY";
};

type StoreOffer = {
  productId: string;
  variantId: string | null;
  sku: string | null;
  title: string;
  brand: string | null;
  barcode: string | null;
  price: number | null;
  stock: number | null;
  issue?: "invalid_variant" | "invalid_offer";
};

type Difference = {
  field: "title" | "price" | "available";
  store: string | number;
  hub: string | number | null;
};

type Comparison = StoreOffer & {
  status: "MATCH" | "DIFF" | "NO_SKU" | "NOT_FOUND" | "AMBIGUOUS" | "IDENTITY_CONFLICT" | "INVALID";
  hubProductId?: string;
  differences: Difference[];
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedName(value: string | null) {
  return cleanText(value).normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
}

function integer(value: unknown, min: number) {
  const n = typeof value === "number" || (typeof value === "string" && value.trim())
    ? Number(value)
    : NaN;
  return Number.isSafeInteger(n) && n >= min && n <= 2_147_483_647 ? n : null;
}

function storeOffers(product: PilotStoreProduct): StoreOffer[] {
  const variants = product.variants;
  const base = {
    productId: product.id,
    variantId: null,
    sku: cleanText(product.supplierSku) || null,
    title: product.name,
    brand: product.brand,
    barcode: cleanText(product.barcode) || null,
    price: integer(product.price, 1),
    stock: integer(product.stock, 0),
  };
  if (variants == null || (Array.isArray(variants) && variants.length === 0)) {
    return [{ ...base, ...(base.price === null || base.stock === null ? { issue: "invalid_offer" } : {}) }];
  }
  if (!Array.isArray(variants)) return [{ ...base, issue: "invalid_variant" }];

  const ids = new Map<string, number>();
  for (const row of variants) {
    const id = cleanText(row?.id);
    ids.set(id, (ids.get(id) ?? 0) + 1);
  }
  return variants.map((row: unknown): StoreOffer => {
    const variant = row && typeof row === "object" && !Array.isArray(row)
      ? row as Record<string, unknown>
      : {};
    const id = cleanText(variant.id);
    const label = cleanText(variant.label);
    const price = integer(variant.price, 1);
    const stock = integer(variant.stock, 0);
    const valid = Boolean(id && id === variant.id && label && ids.get(id) === 1 && price !== null && stock !== null);
    return {
      productId: product.id,
      variantId: id || null,
      sku: cleanText(variant.sku) || null,
      title: label ? product.name + " · " + label : product.name,
      brand: product.brand,
      barcode: cleanText(variant.barcode) || null,
      price,
      stock,
      ...(!valid ? { issue: "invalid_variant" } : {}),
    };
  });
}

function bySku<T extends { sku: string | null }>(offers: T[]) {
  const map = new Map<string, T[]>();
  for (const offer of offers) {
    const sku = cleanText(offer.sku);
    if (!sku) continue;
    const group = map.get(sku);
    if (group) group.push(offer);
    else map.set(sku, [offer]);
  }
  return map;
}

export function auditCatalogHubPilot(input: {
  products: PilotStoreProduct[];
  hubProducts: PilotHubProduct[];
  ordersByStatus: Array<{ status: string; count: number }>;
  orderLines: PilotOrderLine[];
}) {
  if (Math.max(input.products.length, input.hubProducts.length, input.orderLines.length) > PILOT_AUDIT_LIMIT) {
    throw new Error("catalog_hub_pilot_limit");
  }
  const offers: StoreOffer[] = [];
  for (const product of input.products) {
    if (Array.isArray(product.variants) && offers.length + product.variants.length > PILOT_AUDIT_LIMIT) {
      throw new Error("catalog_hub_pilot_limit");
    }
    for (const offer of storeOffers(product)) offers.push(offer);
    if (offers.length > PILOT_AUDIT_LIMIT) throw new Error("catalog_hub_pilot_limit");
  }
  const storeBySku = bySku(offers);
  const hubBySku = bySku(input.hubProducts);
  const comparisons = offers.map((offer): Comparison => {
    const row = { ...offer, differences: [] as Difference[] };
    if (offer.issue) return { ...row, status: "INVALID" };
    if (!offer.sku) return { ...row, status: "NO_SKU" };
    const candidates = hubBySku.get(offer.sku) ?? [];
    if (storeBySku.get(offer.sku)!.length > 1 || candidates.length > 1) return { ...row, status: "AMBIGUOUS" };
    const [hub] = candidates;
    if (!hub) return { ...row, status: "NOT_FOUND" };
    if (!cleanText(hub.id) || integer(hub.available, 0) === null || (hub.price !== null && integer(hub.price, 0) === null)) {
      return { ...row, status: "INVALID" };
    }
    const brand = normalizedName(offer.brand);
    const hubBarcode = cleanText(hub.barcode);
    if (!brand || brand !== normalizedName(hub.brand) || (offer.barcode && hubBarcode && offer.barcode !== hubBarcode)) {
      return { ...row, status: "IDENTITY_CONFLICT" };
    }
    if (normalizedName(offer.title) !== normalizedName(hub.title)) {
      row.differences.push({ field: "title", store: offer.title, hub: hub.title });
    }
    if (offer.price !== hub.price) row.differences.push({ field: "price", store: offer.price!, hub: hub.price });
    if (offer.stock !== hub.available) row.differences.push({ field: "available", store: offer.stock!, hub: hub.available });
    return { ...row, hubProductId: hub.id, status: row.differences.length ? "DIFF" : "MATCH" };
  });

  const counts = { MATCH: 0, DIFF: 0, NO_SKU: 0, NOT_FOUND: 0, AMBIGUOUS: 0, IDENTITY_CONFLICT: 0, INVALID: 0 };
  const mapped = new Map<string, Comparison>();
  const variantKey = (productId: string, variantId: string | null) => JSON.stringify([productId, variantId]);
  for (const row of comparisons) {
    counts[row.status]++;
    if (row.hubProductId) mapped.set(variantKey(row.productId, row.variantId), row);
  }
  const orders = { total: 0, open: 0, lines: input.orderLines.length, mappedLines: 0, openUnmappedLines: 0, missingSavedSku: 0 };
  const orderIssues: OrderIssue[] = [];
  const isOpen = (status: string) => status !== "DONE" && status !== "CANCELED";
  for (const order of input.ordersByStatus) {
    orders.total += order.count;
    if (isOpen(order.status)) orders.open += order.count;
  }
  for (const line of input.orderLines) {
    const row = mapped.get(variantKey(line.productId, line.variantId));
    const sku = cleanText(line.sku);
    if (!sku) orders.missingSavedSku++;
    // The recorded order SKU is required even when the current product ID resolves.
    const reason = !sku ? "MISSING_SKU" : !row ? "NO_MAPPING" :
      row.sku !== sku ? "SKU_CHANGED" : integer(line.qty, 1) === null ? "INVALID_QUANTITY" : null;
    if (!reason) orders.mappedLines++;
    else if (isOpen(line.status)) {
      orders.openUnmappedLines++;
      if (orderIssues.length < 20) {
        orderIssues.push({ orderId: line.orderId, productId: line.productId, variantId: line.variantId, sku: line.sku, reason });
      }
    }
  }
  return {
    summary: {
      cards: input.products.length,
      variantCards: input.products.filter(p => Array.isArray(p.variants) && p.variants.length > 0).length,
      offers: offers.length,
      hubProducts: input.hubProducts.length,
      hubOnly: input.hubProducts.filter(p => !storeBySku.has(cleanText(p.sku))).length,
      counts,
      orders,
    },
    comparisons,
    orderIssues,
  };
}

export type CatalogHubPilotAudit = ReturnType<typeof auditCatalogHubPilot>;
