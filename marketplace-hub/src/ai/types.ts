export type CatalogProductInput = {
  sku: string;
  title: string;
  brand?: string;
  barcode?: string;
  categoryKey?: string;
  description?: string;
  volumeValue?: number;
  volumeUnit?: string;
};

export type AllowedSourcePolicy = {
  domain: string;
  allowSubdomains: boolean;
  sourceType?: "OFFICIAL_SITE" | "DISTRIBUTOR" | "DISCOVERED_WEB";
};

export type ExtractedProductData = {
  title: string | null;
  description: string | null;
  sku: string | null;
  brand: string | null;
  canonicalUrl: string | null;
  images: string[];
  ingredients: string | null;
  application: string | null;
  price: number | null;
  currency: string | null;
  rawJsonLd: Record<string, unknown> | null;
};

export type GeneratedProductCopy = {
  shortDescription: string;
  description: string;
  application: string;
  ingredients: string;
  warnings: string[];
};
