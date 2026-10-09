import "server-only";

import {
  getCatalogHubProductBySku,
  getCatalogHubShadowConfig,
  getCatalogHubSnapshot,
  type CatalogHubProduct,
  type CatalogHubSnapshotItem,
} from "@/lib/catalogHubClient";

type OverlayableProduct = {
  id: string;
  name: string;
  image: string;
  price: number;
  stock: number;
  category: string;
  supplierSku?: string | null;
  shortDescription?: string | null;
  description?: string | null;
  productLineName?: string | null;
  volumeValue?: number | null;
  volumeUnit?: string | null;
  variants?: unknown;
  brand?: ({ name: string } & Record<string, unknown>) | null;
  [key: string]: unknown;
};

function attributesRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function firstImage(images: unknown) {
  if (!Array.isArray(images)) return "";
  return (
    images.find(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    )?.trim() || ""
  );
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown) {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

type OverlaySource = {
  sku: string;
  title: string;
  brand: string | null;
  shortDescription: string | null;
  description: string | null;
  categoryKey: string | null;
  attributes: unknown;
  images: string[];
  price: number | null;
  stock: number;
};

function applyHubOverlay<T extends OverlayableProduct>(
  product: T,
  hub: OverlaySource,
): T {
  const attributes = attributesRecord(hub.attributes);
  const image = firstImage(hub.images);
  const volumeValue = optionalNumber(attributes.volumeValue);
  const volumeUnit = optionalText(attributes.volumeUnit);
  const productLineName = optionalText(attributes.productLineName);
  const variants = Array.isArray(attributes.variants)
    ? attributes.variants
    : product.variants;

  const brand = hub.brand
    ? ({
        ...(product.brand || {}),
        name: hub.brand,
      } as T["brand"])
    : product.brand;

  return {
    ...product,
    name: hub.title,
    image: image || product.image,
    shortDescription: hub.shortDescription ?? product.shortDescription,
    description: hub.description ?? product.description,
    price: hub.price ?? product.price,
    stock: hub.stock,
    category: hub.categoryKey || product.category,
    supplierSku: hub.sku,
    productLineName: productLineName ?? product.productLineName,
    volumeValue:
      volumeValue === undefined ? product.volumeValue : volumeValue,
    volumeUnit: volumeUnit ?? product.volumeUnit,
    variants,
    brand,
  } as T;
}

function productSource(product: CatalogHubProduct): OverlaySource {
  return {
    sku: product.sku,
    title: product.title,
    brand: product.brand,
    shortDescription: product.shortDescription,
    description: product.description,
    categoryKey: product.categoryKey,
    attributes: product.attributes,
    images: product.images,
    price: product.price,
    stock: product.totals.stock,
  };
}

function snapshotSource(item: CatalogHubSnapshotItem): OverlaySource {
  return {
    sku: item.sku,
    title: item.title,
    brand: item.brand,
    shortDescription: item.shortDescription,
    description: item.description,
    categoryKey: item.categoryKey,
    attributes: item.attributes,
    images: item.images,
    price: item.price,
    stock: item.stock,
  };
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function overlayCatalogHubProduct<T extends OverlayableProduct>(
  product: T | null,
): Promise<T | null> {
  if (!product) return product;

  const config = getCatalogHubShadowConfig();
  if (!config.readEnabled) return product;

  if (!config.configured) {
    if (config.readStrict) {
      throw new Error("catalog_hub_read_not_configured");
    }
    return product;
  }

  const sku = product.supplierSku?.trim();
  if (!sku) {
    if (config.readStrict) {
      throw new Error("catalog_hub_product_sku_missing");
    }
    return product;
  }

  try {
    const hub = await getCatalogHubProductBySku(sku);
    if (!hub) {
      if (config.readStrict) {
        throw new Error("catalog_hub_product_not_found");
      }
      return product;
    }
    return applyHubOverlay(product, productSource(hub));
  } catch (error) {
    if (config.readStrict) throw error;
    console.error("Catalog Hub product overlay failed", {
      sku,
      error: safeError(error),
    });
    return product;
  }
}

export async function overlayCatalogHubProducts<T extends OverlayableProduct>(
  products: T[],
): Promise<T[]> {
  if (!products.length) return products;

  const config = getCatalogHubShadowConfig();
  if (!config.readEnabled) return products;

  if (!config.configured) {
    if (config.readStrict) {
      throw new Error("catalog_hub_read_not_configured");
    }
    return products;
  }

  try {
    const snapshot = await getCatalogHubSnapshot();
    const bySku = new Map(
      snapshot.items.map((item) => [item.sku, snapshotSource(item)]),
    );

    const missing: string[] = [];
    const overlaid = products.map((product) => {
      const sku = product.supplierSku?.trim();
      if (!sku) {
        if (config.readStrict) missing.push("<missing-sku>");
        return product;
      }

      const hub = bySku.get(sku);
      if (!hub) {
        missing.push(sku);
        return product;
      }

      return applyHubOverlay(product, hub);
    });

    if (config.readStrict && missing.length) {
      throw new Error(
        "catalog_hub_snapshot_missing:" + missing.slice(0, 20).join(","),
      );
    }

    return overlaid;
  } catch (error) {
    if (config.readStrict) throw error;
    console.error("Catalog Hub snapshot overlay failed", {
      error: safeError(error),
    });
    return products;
  }
}
