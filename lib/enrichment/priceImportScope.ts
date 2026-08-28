import { cookies } from "next/headers";

export const ENRICHMENT_PRICE_IMPORT_COOKIE = "enrichment_price_import";

export async function getEnrichmentPriceImportId() {
  const cookieStore = await cookies();
  const value = cookieStore.get(ENRICHMENT_PRICE_IMPORT_COOKIE)?.value?.trim() || "";
  return value && value !== "ALL" ? value : null;
}

export function productImportScope(importId: string | null) {
  return importId
    ? {
        importRows: {
          some: { importId },
        },
      }
    : {};
}
